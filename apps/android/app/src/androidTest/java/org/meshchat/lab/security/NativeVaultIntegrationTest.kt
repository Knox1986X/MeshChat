package org.meshchat.lab.security

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.meshchat.corelib.Vault
import org.meshchat.corelib.VaultException

/** Actual Kotlin/JNA/UniFFI/SQLCipher roundtrip; PUBLIC SYNTHETIC key, no biometrics. */
@RunWith(AndroidJUnit4::class)
class NativeVaultIntegrationTest {
    private fun fixture(action: (Vault, File) -> Unit) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.noBackupFilesDir, "test-native-" + UUID.randomUUID())
        check(directory.mkdir())
        val vault = Vault(directory.canonicalPath, ByteArray(16) { 1 })
        try {
            action(vault, directory)
        } finally {
            try { vault.shutdown() } finally { vault.destroy() }
            directory.listFiles()?.forEach { check(it.delete()) }
            check(directory.delete())
        }
    }

    @Test fun nativeCreateLockAndReopenUsesTheSameEncryptedDatabase() = fixture { vault, directory ->
        val key = ByteArray(32) { 7 } // Public test key, never user/device material.
        try {
            assertThrows(VaultException.Locked::class.java) { vault.sessionCount() }
            val create = vault.beginUnlock()
            try { create.create(key) } finally { create.destroy() }
            assertTrue(vault.sessionCount() == 0uL)
            val header = File(directory, "vault.lab.db").inputStream().use { input ->
                ByteArray(16).also { check(input.read(it) == 16) }
            }
            assertFalse(header.contentEquals("SQLite format 3\u0000".toByteArray()))
            vault.lockVault()
            assertThrows(VaultException.Locked::class.java) { vault.sessionCount() }
            val reopen = vault.beginUnlock()
            try { reopen.openExisting(key) } finally { reopen.destroy() }
            assertTrue(vault.sessionCount() == 0uL)
        } finally { key.fill(0) }
    }

    @Test fun lateUnlockCannotCreateFileAfterLock() = fixture { vault, directory ->
        val attempt = vault.beginUnlock()
        val key = ByteArray(32) { 7 }
        try {
            vault.lockVault()
            assertThrows(VaultException.StaleUnlock::class.java) { attempt.create(key) }
            assertFalse(File(directory, "vault.lab.db").exists())
        } finally { key.fill(0); attempt.destroy() }
    }

    @Test fun shutdownIsTerminalEvenWithAnOldGeneratedHandle() = fixture { vault, _ ->
        val attempt = vault.beginUnlock()
        val key = ByteArray(32) { 7 }
        try {
            vault.shutdown()
            assertThrows(VaultException.StaleUnlock::class.java) { attempt.create(key) }
            assertThrows(VaultException.Closed::class.java) { vault.beginUnlock() }
        } finally { key.fill(0); attempt.destroy() }
    }
}
