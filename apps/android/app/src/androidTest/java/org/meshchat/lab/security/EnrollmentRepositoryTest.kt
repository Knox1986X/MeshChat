package org.meshchat.lab.security

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.meshchat.corelib.Vault
import org.meshchat.lab.vault.EnrollmentRecord
import org.meshchat.lab.vault.EnrollmentRepository

/** Public synthetic fixtures, NOT hardware wrapping or a user-vault UI test. */
@RunWith(AndroidJUnit4::class)
class EnrollmentRepositoryTest {
    private val binding = ByteArray(16) { 7 }
    private val wrapper = ByteArray(61) { 8 }.also { it[0] = 1 }
    private fun fixture(block: (File, EnrollmentRepository) -> Unit) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.noBackupFilesDir, "enrollment-test-" + UUID.randomUUID())
        check(directory.mkdir())
        try { block(directory, EnrollmentRepository(directory)) }
        finally { check(directory.deleteRecursively()) }
    }
    private fun EnrollmentRepository.reserve() = reserve(binding, EnrollmentRecord.Policy.STRONGBOX_REQUIRED)

    @Test fun persistedReadyRecordReopensActualNativeDatabase() = fixture { directory, repository ->
        assertEquals(EnrollmentRepository.Status.EMPTY, repository.inspect())
        repository.reserve()
        repository.saveWrapper(binding, wrapper)
        val vault = Vault(directory.canonicalPath, binding)
        val key = ByteArray(32) { 9 }
        try {
            val attempt = vault.beginUnlock()
            try { attempt.create(key) } finally { attempt.destroy() }
            vault.lockVault()
            repository.markReady(binding)
        } finally { try { vault.shutdown() } finally { vault.destroy() }; key.fill(0) }
        // New repository and native owner: model process restart without retained handles.
        val reopened = EnrollmentRepository(directory)
        assertEquals(EnrollmentRepository.Status.READY_LOCKED, reopened.inspect())
        assertArrayEquals(wrapper, reopened.loadReady().wrapped())
        assertEquals(EnrollmentRecord.Policy.STRONGBOX_REQUIRED, reopened.loadReady().policy)
        val fresh = Vault(directory.canonicalPath, reopened.loadReady().binding())
        val publicKey = ByteArray(32) { 9 }
        try {
            val attempt = fresh.beginUnlock()
            try { attempt.openExisting(publicKey) } finally { attempt.destroy() }
            assertTrue(fresh.sessionCount() == 0uL)
        } finally { try { fresh.shutdown() } finally { fresh.destroy() }; publicKey.fill(0) }
    }
    @Test fun interruptionBeforeWrappingNeverAutomaticallyReenrolls() = fixture { directory, repository ->
        repository.reserve()
        val next = EnrollmentRepository(directory)
        assertEquals(EnrollmentRepository.Status.CREATION_INTERRUPTED, next.inspect())
        assertThrows(EnrollmentRepository.Rejected::class.java) { next.reserve() }
        assertThrows(EnrollmentRepository.Rejected::class.java) { next.loadReady() }
        assertFalse(File(directory, "vault.lab.db").exists())
    }
    @Test fun interruptionAfterWrapperOrDuringDatabaseCreationStaysUnready() = fixture { directory, repository ->
        repository.reserve(); repository.saveWrapper(binding, wrapper)
        assertEquals(EnrollmentRepository.Status.CREATION_INTERRUPTED, repository.inspect())
        assertThrows(EnrollmentRepository.Rejected::class.java) { repository.markReady(binding) }
        File(directory, "vault.lab.db").writeBytes(byteArrayOf())
        assertThrows(EnrollmentRepository.Rejected::class.java) { repository.markReady(binding) }
        assertThrows(EnrollmentRepository.Rejected::class.java) { repository.reserve() }
    }
    @Test fun orphanDatabaseIsNotOverwritten() = fixture { directory, repository ->
        val database = File(directory, "vault.lab.db")
        database.writeBytes(byteArrayOf(1, 2, 3))
        assertEquals(EnrollmentRepository.Status.INCONSISTENT, repository.inspect())
        assertThrows(EnrollmentRepository.Rejected::class.java) { repository.reserve() }
        assertArrayEquals(byteArrayOf(1, 2, 3), database.readBytes())
    }
    @Test fun truncatedAndOversizedMetadataFailClosed() = fixture { directory, repository ->
        val file = File(directory, "enrollment.v1")
        for (size in listOf(0, 27, 29, 90, 100000)) {
            file.writeBytes(ByteArray(size))
            assertEquals(EnrollmentRepository.Status.UNREADABLE, repository.inspect())
            assertThrows(Exception::class.java) { repository.reserve() }
            assertEquals(size.toLong(), file.length())
        }
    }
    @Test fun atomicLeftoversAreNotSilentlyRestored() = fixture { directory, repository ->
        repository.reserve()
        val original = File(directory, "enrollment.v1").readBytes()
        for (suffix in listOf(".new", ".bak")) {
            val leftover = File(directory, "enrollment.v1" + suffix)
            leftover.writeBytes(byteArrayOf(1))
            assertEquals(EnrollmentRepository.Status.INCONSISTENT, repository.inspect())
            assertThrows(EnrollmentRepository.Rejected::class.java) { repository.saveWrapper(binding, wrapper) }
            assertArrayEquals(original, File(directory, "enrollment.v1").readBytes())
            assertTrue(leftover.delete())
        }
    }
    @Test fun crossBindingOrRepeatedTransitionCannotReplaceMetadata() = fixture { directory, repository ->
        repository.reserve()
        assertThrows(EnrollmentRepository.Rejected::class.java) { repository.saveWrapper(ByteArray(16), wrapper) }
        repository.saveWrapper(binding, wrapper)
        val original = File(directory, "enrollment.v1").readBytes()
        assertThrows(IllegalStateException::class.java) { repository.saveWrapper(binding, wrapper) }
        assertArrayEquals(original, File(directory, "enrollment.v1").readBytes())
    }
}
