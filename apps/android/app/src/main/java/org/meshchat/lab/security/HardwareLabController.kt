package org.meshchat.lab.security

import android.app.Activity
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors

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
        var wrapped: ByteArray? = null,
        var expectedDigest: ByteArray? = null,
    )
    private val worker = Executors.newSingleThreadExecutor()
    private val prompts = BiometricCoordinator(activity, ownerIsResumed)
    private val random = SecureRandom()
    private var active: Run? = null
    private var closed = false

    fun start(policy: AndroidKeyProtector.EnrollmentPolicy) {
        check(!closed)
        cancel()
        val alias = "meshchat.lab.wrap.v1." + randomBytes(16).joinToString("") { "%02x".format(it.toInt() and 255) }
        val run = Run(AndroidKeyProtector(alias), randomBytes(16))
        active = run
        report("Создание временного hardware key…")
        worker.execute {
            try {
                val level = run.protector.create(policy)
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
            val digest = try {
                MessageDigest.getInstance("SHA-256").digest(key)
            } finally {
                key.fill(0)
            }
            val matches = try {
                MessageDigest.isEqual(digest, checkNotNull(run.expectedDigest))
            } finally {
                digest.fill(0)
            }
            if (matches) finish(run, "Hardware roundtrip выполнен. Удаление временного ключа…")
            else fail(run, "Проверка roundtrip не пройдена.")
        }, onFailure = {
            fail(run, "Unwrap отменён или недоступен.")
        })
    }

    private fun fail(run: Run, message: String) {
        if (active !== run || closed) return
        finish(run, message)
    }

    private fun finish(run: Run, message: String) {
        if (active !== run) return
        active = null
        prompts.cancel()
        report(message)
        cleanup(run)
    }

    fun cancel() {
        val run = active
        active = null // Invalidate result delivery BEFORE cancelling the OS prompt.
        prompts.cancel()
        if (run != null) {
            report("Тест остановлен; временный ключ будет удалён.")
            cleanup(run)
        }
    }

    private fun cleanup(run: Run) {
        worker.execute {
            var removed = true
            try {
                // The only keys managed here are created for this explicit LAB run.
                run.protector.deleteAfterExplicitUserDecision()
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

    private fun randomBytes(size: Int): ByteArray = ByteArray(size).also(random::nextBytes)
}
