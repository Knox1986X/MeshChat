package org.meshchat.lab.vault

import org.junit.Assert.*
import org.junit.Test

class EnrollmentRecordTest {
    private fun reserved() = EnrollmentRecord(EnrollmentRecord.Phase.RESERVED,
        EnrollmentRecord.Policy.STRONGBOX_REQUIRED, ByteArray(16) { 7 })
    private fun wrapper() = ByteArray(61) { 8 }.also { it[0] = 1 }

    @Test fun stagesRoundtripAndOnlyAdvanceInOrder() {
        val reserved = reserved()
        val wrapped = reserved.withWrapper(wrapper())
        val ready = wrapped.ready()
        listOf(reserved, wrapped, ready).forEach {
            assertArrayEquals(it.encode(), EnrollmentRecord.decode(it.encode()).encode())
        }
        assertThrows(IllegalStateException::class.java) { reserved.ready() }
        assertThrows(IllegalStateException::class.java) { ready.withWrapper(wrapper()) }
        assertThrows(IllegalStateException::class.java) { ready.ready() }
    }
    @Test fun rejectsEveryTruncationAndTrailingData() {
        listOf(reserved(), reserved().withWrapper(wrapper())).forEach { record ->
            val encoded = record.encode()
            for (size in 0 until encoded.size) {
                assertThrows(IllegalArgumentException::class.java) { EnrollmentRecord.decode(encoded.copyOf(size)) }
            }
            assertThrows(IllegalArgumentException::class.java) { EnrollmentRecord.decode(encoded + byteArrayOf(0)) }
        }
    }
    @Test fun rejectsUnknownMagicPhasePolicyReservedAndWrapperVersion() {
        val bytes = reserved().withWrapper(wrapper()).encode()
        for (index in listOf(0, 7, 8, 9, 10, 11, 28)) {
            assertThrows(RuntimeException::class.java) {
                EnrollmentRecord.decode(bytes.copyOf().also { it[index] = 127 })
            }
        }
    }
    @Test fun ownsCopiesAndDerivesAliasWithoutCallerStrings() {
        val binding = ByteArray(16) { 7 }
        val wrapped = wrapper()
        val record = EnrollmentRecord(EnrollmentRecord.Phase.WRAPPED,
            EnrollmentRecord.Policy.TEE_EXPLICIT, binding, wrapped)
        val original = record.encode()
        binding.fill(0); wrapped.fill(0); record.binding().fill(0); record.wrapped().fill(0)
        assertArrayEquals(original, record.encode())
        assertEquals("meshchat.lab.wrap.v1." + "07".repeat(16), record.alias())
    }
}
