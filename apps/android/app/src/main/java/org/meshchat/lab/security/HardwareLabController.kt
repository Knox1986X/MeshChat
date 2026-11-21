package org.meshchat.lab.security

import android.app.Activity
import android.os.Handler
import android.os.Looper
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.io.File
import org.meshchat.corelib.Vault as NativeVault
import org.meshchat.corelib.VaultException

/**
 * Explicit LAB-only, ephemeral wrap/unwrap roundtrip. No personal data/persistence.
 * Creation, provider inspection and deletion are serialized on a private worker.
 * Only the short authenticated doFinal runs in the main-thread prompt callback.
 * Activity must call cancel on pause/screen off and close on destroy.
 */
internal class HardwareLabController(
    private val activity: Activity,
    ownerIsResumed: () -> Boolean,
    private val report: (String) -> Unit,
) : AutoCloseable {
    private class Run(
        val protector: AndroidKeyProtector,
        val vaultId: ByteArray,
        val core: NativeVault,
        val directory: File,
        var wrapped: ByteArray? = null,
        var expectedDigest: ByteArray? = null,
        var createdByThisRun: Boolean = false, // Accessed only on serialized worker.
    )
    private val worker = Executors.newSingleThreadExecutor()
    private val timeouts = Handler(Looper.getMainLooper())
    private var deadline: Runnable? = null
    private val prompts = BiometricCoordinator(activity, ownerIsResumed)
    private val random = SecureRandom()
    private var active: Run? = null
    private var closed = false

    fun start(policy: AndroidKeyProtector.EnrollmentPolicy) {
        check(!closed)
        cancel()
        val alias = "meshchat.lab.wrap.v1." + randomBytes(16).joinToString("") { "%02x".format(it.toInt() and 255) }
        val directory = File(activity.noBackupFilesDir, "native-lab-" + alias.substringAfterLast('.'))
        if (!directory.mkdir()) {
            report("Не удалось создать отдельную приватную папку LAB. Тест не запущен.")
            return
        }
        val vaultId = randomBytes(16)
        val core = try {
            NativeVault(directory.canonicalPath, vaultId)
        } catch (_: Exception) {
            directory.delete()
            report("Rust-хранилище недоступно. Программной подмены ядра нет.")
            return
        } catch (_: LinkageError) {
            directory.delete()
            report("Нативная библиотека не загрузилась. Тест остановлен без fallback.")
            return
        }
        val run = Run(AndroidKeyProtector(alias), vaultId, core, directory)
        active = run
        deadline = Runnable { if (active === run) cancel() }.also { timeouts.postDelayed(it, 60000) }
        report("Создание временного hardware key…")
        worker.execute {
            try {
                val level = run.protector.create(policy)
                run.createdByThisRun = true
                val operation = run.protector.beginWrap(run.vaultId)
                activity.runOnUiThread {
                    if (active !== run || closed) {
                        operation.close()
                    } else {
                        report("Класс: ${level.name}. Подтвердите wrapping тестового ключа.")
                        authenticateWrap(run, operation)
                    }
                }
            } catch (_: Exception) {
                activity.runOnUiThread { fail(run, "Hardware key недоступен; автоматического fallback нет.") }
            }
        }
    }

    private fun authenticateWrap(run: Run, operation: AndroidKeyProtector.WrapOperation) {
        prompts.authenticate(operation, operation.cryptoObject, onAuthenticated = {
            val key = randomBytes(32)
            try {
                run.expectedDigest = MessageDigest.getInstance("SHA-256").digest(key)
                run.wrapped = operation.finishConsumingKeyAfterAuthentication(key)
            } finally {
                key.fill(0)
            }
            report("Wrapping завершён. Готовится проверка unwrap…")
            worker.execute {
                try {
                    val unwrap = run.protector.beginUnwrap(run.vaultId, checkNotNull(run.wrapped))
                    activity.runOnUiThread {
                        if (active !== run || closed) unwrap.close()
                        else authenticateUnwrap(run, unwrap)
                    }
                } catch (_: Exception) {
                    activity.runOnUiThread { fail(run, "Unwrap недоступен. Ключ не пересоздаётся.") }
                }
            }
        }, onFailure = {
            fail(run, "Биометрическая операция отменена или недоступна.")
        })
    }

    private fun authenticateUnwrap(run: Run, operation: AndroidKeyProtector.UnwrapOperation) {
        report("Подтвердите unwrap. Восстановленный тестовый ключ сразу очищается.")
        prompts.authenticate(operation, operation.cryptoObject, onAuthenticated = {
            val key = operation.finishAfterAuthentication()
            try {
                val digest = MessageDigest.getInstance("SHA-256").digest(key)
                val matches = try {
                    MessageDigest.isEqual(digest, checkNotNull(run.expectedDigest))
                } finally {
                    digest.fill(0)
                }
                if (matches) probeNativeStore(run, key.copyOf())
                else fail(run, "Проверка roundtrip не пройдена.")
            } finally {
                key.fill(0)
            }
        }, onFailure = {
            fail(run, "Unwrap отменён или недоступен.")
        })
    }

    /** Owns keyCopy; never reports native error text or returns a plaintext key. */
    private fun probeNativeStore(run: Run, keyCopy: ByteArray) {
        val attempt = try {
            require(keyCopy.size == 32)
            run.core.beginUnlock()
        } catch (_: Exception) {
            keyCopy.fill(0)
            fail(run, "Rust gate не разрешил открытие хранилища.")
            return
        }
        report("Hardware roundtrip выполнен. Проверяется Rust SQLCipher через UniFFI…")
        worker.execute {
            try {
                attempt.create(keyCopy)
                check(run.core.sessionCount() == 0uL)
                run.core.lockVault()
                val blocked = try {
                    run.core.sessionCount()
                    false
                } catch (_: VaultException.Locked) {
                    true
                }
                check(blocked)
                val reopen = run.core.beginUnlock()
                try {
                    reopen.openExisting(keyCopy)
                    check(run.core.sessionCount() == 0uL)
                } finally {
                    reopen.destroy()
                }
                run.core.lockVault()
                activity.runOnUiThread {
                    if (active === run && !closed) {
                        finish(run, "Hardware + Rust SQLCipher roundtrip выполнен; lock блокирует доступ. Удаление временных данных…")
                    }
                }
            } catch (_: Exception) {
                activity.runOnUiThread { fail(run, "Rust SQLCipher тест остановлен; ключ/БД не пересоздаются автоматически.") }
            } finally {
                keyCopy.fill(0)
                attempt.destroy()
            }
        }
    }

    private fun fail(run: Run, message: String) {
        if (active !== run || closed) return
        finish(run, message)
    }

    private fun finish(run: Run, message: String) {
        if (active !== run) return
        active = null
        clearDeadline()
        prompts.cancel()
        report(message)
        cleanup(run)
    }

    fun cancel() {
        val run = active
        active = null // Invalidate result delivery BEFORE cancelling the OS prompt.
        clearDeadline()
        prompts.cancel()
        if (run != null) {
            // Terminal for this run: worker must not start a fresh unlock after cancel.
            try {
                run.core.shutdown()
                report("Доступ Rust отозван; ожидается очистка временных данных.")
            } catch (_: Exception) {
                report("Ошибка закрытия Rust: тест заблокирован; выполняется очистка.")
            }
            cleanup(run)
        }
    }

    private fun cleanup(run: Run) {
        worker.execute {
            var removed = true
            try {
                run.core.shutdown()
            } catch (_: Exception) {
                removed = false
            } finally {
                try { run.core.destroy() } catch (_: Exception) { removed = false }
            }
            try {
                for (suffix in listOf("", "-wal", "-shm", "-journal")) {
                    val file = File(run.directory, "vault.lab.db" + suffix)
                    if (file.exists() && !file.delete()) removed = false
                }
                if (!run.directory.delete()) removed = false
            } catch (_: Exception) {
                removed = false
            }
            try {
                // Never delete a pre-existing alias after ALIAS_EXISTS or creation failure.
                if (run.createdByThisRun) {
                    run.protector.deleteAfterExplicitUserDecision()
                    run.createdByThisRun = false
                }
            } catch (_: Exception) {
                removed = false
            } finally {
                run.wrapped?.fill(0)
                run.expectedDigest?.fill(0)
                run.vaultId.fill(0)
            }
            if (!removed) activity.runOnUiThread {
                if (!closed) report("Не удалось удалить тестовый alias; удалите данные LAB-приложения.")
            }
        }
    }

    override fun close() {
        if (closed) return
        cancel()
        closed = true
        prompts.close()
        // Queued cleanup completes; never block Activity/main thread on awaitTermination.
        worker.shutdown()
    }

    private fun clearDeadline() {
        deadline?.let(timeouts::removeCallbacks)
        deadline = null
    }

    private fun randomBytes(size: Int): ByteArray = ByteArray(size).also(random::nextBytes)
}
