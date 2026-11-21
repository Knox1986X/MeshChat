package org.meshchat.lab.vault

import android.util.AtomicFile
import java.io.File
import java.io.RandomAccessFile

/** Private noBackupFilesDir only. No delete/reset, key replacement, key bytes or auto-repair API.
 * Must run on worker. File lock excludes concurrent repository instances/processes.
 * AtomicFile is crash-tolerant metadata replacement, NOT a power-loss/anti-rollback proof.
 */
internal class EnrollmentRepository(private val directory: File) {
    enum class Status { EMPTY, CREATION_INTERRUPTED, READY_LOCKED, INCONSISTENT, UNREADABLE }
    class Rejected : Exception("Enrollment state rejected")
    private val recordFile = File(directory, "enrollment.v1")
    private val database = File(directory, "vault.lab.db")
    private val atomic = AtomicFile(recordFile)

    private fun <T> exclusive(block: () -> T): T {
        check(directory.isDirectory) // Caller creates private directory, not attacker input.
        RandomAccessFile(File(directory, ".enrollment.lock"), "rw").use { handle ->
            handle.channel.lock().use { return block() }
        }
    }

    private fun unfinishedWrite(): Boolean = listOf(".new", ".bak").any { File(recordFile.path + it).exists() }
    private fun hasDatabaseArtifacts(): Boolean = listOf("", "-wal", "-shm", "-journal").any {
        File(database.path + it).exists()
    }
    private fun unexpectedFiles(): Boolean = directory.list()?.any {
        it !in setOf(".enrollment.lock", "enrollment.v1", "vault.lab.db", "vault.lab.db-wal",
            "vault.lab.db-shm", "vault.lab.db-journal")
    } ?: true

    private fun read(): EnrollmentRecord {
        val bytes = recordFile.inputStream().use { it.readBytesBounded() }
        return EnrollmentRecord.decode(bytes)
    }
    private fun java.io.InputStream.readBytesBounded(): ByteArray {
        val bytes = ByteArray(EnrollmentRecord.MAX_BYTES + 1)
        var offset = 0
        while (offset < bytes.size) {
            val count = read(bytes, offset, bytes.size - offset)
            if (count < 0) break
            check(count > 0)
            offset += count
        }
        require(offset <= EnrollmentRecord.MAX_BYTES)
        return bytes.copyOf(offset)
    }
    private fun statusLocked(): Status {
        if (unfinishedWrite() || unexpectedFiles()) return Status.INCONSISTENT
        if (!recordFile.exists()) return if (hasDatabaseArtifacts()) Status.INCONSISTENT else Status.EMPTY
        val record = read()
        return when (record.phase) {
            EnrollmentRecord.Phase.RESERVED -> if (hasDatabaseArtifacts()) Status.INCONSISTENT else Status.CREATION_INTERRUPTED
            EnrollmentRecord.Phase.WRAPPED -> Status.CREATION_INTERRUPTED
            EnrollmentRecord.Phase.READY -> if (database.isFile && database.length() > 0) Status.READY_LOCKED else Status.INCONSISTENT
        }
    }
    fun inspect(): Status = try { exclusive { statusLocked() } } catch (_: Exception) { Status.UNREADABLE }

    private fun save(record: EnrollmentRecord) {
        val stream = atomic.startWrite()
        try {
            stream.write(record.encode())
            atomic.finishWrite(stream)
        } catch (failure: Exception) {
            atomic.failWrite(stream)
            throw failure
        }
        check(!unfinishedWrite() && read().encode().contentEquals(record.encode()))
    }
    /** Persist BEFORE creating the alias. Any subsequent interruption needs explicit recovery. */
    fun reserve(binding: ByteArray, policy: EnrollmentRecord.Policy) = exclusive {
        if (statusLocked() != Status.EMPTY) throw Rejected()
        save(EnrollmentRecord(EnrollmentRecord.Phase.RESERVED, policy, binding))
    }
    /** Persist authenticated wrapper BEFORE creating SQLCipher DB. */
    fun saveWrapper(expectedBinding: ByteArray, wrapper: ByteArray) = exclusive {
        if (unfinishedWrite() || unexpectedFiles() || hasDatabaseArtifacts()) throw Rejected()
        val record = read()
        if (!record.binding().contentEquals(expectedBinding)) throw Rejected()
        save(record.withWrapper(wrapper))
    }
    /** Caller must have completed authenticated SQLCipher create and closed the DB first.
     * The structural check here cannot establish authentication; READY is never trusted alone.
     */
    fun markReady(expectedBinding: ByteArray) = exclusive {
        if (unfinishedWrite() || unexpectedFiles() || !database.isFile || database.length() == 0L) throw Rejected()
        val record = read()
        if (!record.binding().contentEquals(expectedBinding)) throw Rejected()
        save(record.ready())
    }
    fun loadReady(): EnrollmentRecord = exclusive {
        if (statusLocked() != Status.READY_LOCKED) throw Rejected()
        read()
    }
}
