package org.meshchat.lab.security

import android.app.Activity
import android.app.KeyguardManager
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.os.Looper

/**
 * Main-thread, single-prompt adapter. Never accepts a boolean "authenticated".
 * Owner MUST cancel on onPause/screen-off and close on onDestroy. No persistence.
 * Callbacks are quick completion functions, not background IO/codec tasks.
 */
internal class BiometricCoordinator(
    private val activity: Activity,
    private val ownerIsResumed: () -> Boolean,
) : AutoCloseable {
    enum class Failure { UNAVAILABLE, CANCELLED, OS_ERROR, OWNER_LOCKED, STALE_CRYPTO, COMPLETION_FAILED }
    private val gate = OperationGate()
    private var signal: CancellationSignal? = null
    private var currentFailure: ((Failure) -> Unit)? = null

    fun authenticate(
        resource: AutoCloseable,
        crypto: BiometricPrompt.CryptoObject,
        onAuthenticated: () -> Unit,
        onFailure: (Failure) -> Unit,
    ) {
        assertMainThread()
        cancel() // All old callbacks are invalidated before showing a new prompt.
        if (!ownerIsResumed() || deviceLocked()) {
            resource.close()
            onFailure(Failure.OWNER_LOCKED)
            return
        }
        val ticket = try {
            gate.start(resource)
        } catch (_: Exception) {
            onFailure(Failure.UNAVAILABLE)
            return
        }
        val cancellation = CancellationSignal()
        signal = cancellation
        currentFailure = onFailure
        fun reject(reason: Failure) {
            if (!gate.isCurrent(ticket)) return
            // Gate invalidation must precede cancellation (OS may call back inline).
            gate.cancel()
            signal = null
            currentFailure = null
            cancellation.cancel()
            onFailure(reason)
        }
        try {
            val builder = BiometricPrompt.Builder(activity)
                .setTitle("MeshChat LAB: проверка аппаратного ключа")
                .setSubtitle("Только тестовый ключ. Это не разблокировка мессенджера.")
                .setNegativeButton("Отмена", activity.mainExecutor) { _, _ -> reject(Failure.CANCELLED) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            }
            builder.build().authenticate(
                crypto, cancellation, activity.mainExecutor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (!gate.isCurrent(ticket)) return
                        if (!ownerIsResumed() || deviceLocked()) {
                            reject(Failure.OWNER_LOCKED)
                            return
                        }
                        // Exact operation identity, not just a successful OS callback.
                        if (crypto.cipher == null || result.cryptoObject?.cipher !== crypto.cipher) {
                            reject(Failure.STALE_CRYPTO)
                            return
                        }
                        signal = null
                        currentFailure = null
                        try {
                            gate.complete(ticket, onAuthenticated)
                            if (gate.cleanupFailed()) onFailure(Failure.COMPLETION_FAILED)
                        } catch (_: Exception) {
                            onFailure(Failure.COMPLETION_FAILED)
                        }
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        // OS free-form text never enters app logs/status/analytics.
                        reject(Failure.OS_ERROR)
                    }
                    // onAuthenticationFailed is non-terminal: OS prompt remains active.
                },
            )
        } catch (_: RuntimeException) {
            reject(Failure.UNAVAILABLE)
        }
    }

    fun cancel() {
        assertMainThread()
        val oldSignal = signal
        val oldFailure = currentFailure
        signal = null
        currentFailure = null
        gate.cancel()
        oldSignal?.cancel()
        oldFailure?.invoke(Failure.CANCELLED)
    }

    private fun deviceLocked(): Boolean =
        activity.getSystemService(KeyguardManager::class.java).isDeviceLocked

    override fun close() {
        assertMainThread()
        cancel()
        gate.close()
    }

    private fun assertMainThread() {
        check(Looper.myLooper() == Looper.getMainLooper()) { "main thread required" }
    }
}
