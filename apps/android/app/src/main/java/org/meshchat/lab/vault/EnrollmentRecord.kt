package org.meshchat.lab.vault

/** Public structural metadata, NOT authenticated until Keystore unwrap + SQLCipher open. */
internal class EnrollmentRecord(
    val phase: Phase,
    val policy: Policy,
    binding: ByteArray,
    wrapped: ByteArray? = null,
) {
    enum class Phase { RESERVED, WRAPPED, READY }
    enum class Policy { STRONGBOX_REQUIRED, TEE_EXPLICIT }
    private val bindingBytes = binding.copyOf()
    private val wrappedBytes = wrapped?.copyOf()
    init {
        require(bindingBytes.size == 16)
        require(if (phase == Phase.RESERVED) wrappedBytes == null
                else wrappedBytes != null && wrappedBytes.size == 61 && wrappedBytes[0] == 1.toByte())
    }
    fun binding(): ByteArray = bindingBytes.copyOf()
    fun wrapped(): ByteArray = checkNotNull(wrappedBytes).copyOf()
    fun alias(): String = "meshchat.lab.wrap.v1." + bindingBytes.joinToString("") { "%02x".format(it.toInt() and 255) }

    fun withWrapper(wrapper: ByteArray): EnrollmentRecord {
        check(phase == Phase.RESERVED)
        return EnrollmentRecord(Phase.WRAPPED, policy, bindingBytes, wrapper)
    }
    fun ready(): EnrollmentRecord {
        check(phase == Phase.WRAPPED)
        return EnrollmentRecord(Phase.READY, policy, bindingBytes, wrappedBytes)
    }

    fun encode(): ByteArray = MAGIC + byteArrayOf(phase.ordinal.toByte(), policy.ordinal.toByte(), 0, 0) +
        bindingBytes + (wrappedBytes ?: byteArrayOf())

    companion object {
        private val MAGIC = "MCVLREC1".toByteArray(Charsets.US_ASCII)
        const val MAX_BYTES = 89
        fun decode(bytes: ByteArray): EnrollmentRecord {
            require(bytes.size == 28 || bytes.size == MAX_BYTES)
            require(bytes.copyOfRange(0, 8).contentEquals(MAGIC))
            require(bytes[10] == 0.toByte() && bytes[11] == 0.toByte())
            val phase = Phase.entries.getOrNull(bytes[8].toInt()) ?: error("Invalid phase")
            val policy = Policy.entries.getOrNull(bytes[9].toInt()) ?: error("Invalid policy")
            require(bytes.size == if (phase == Phase.RESERVED) 28 else MAX_BYTES)
            return EnrollmentRecord(phase, policy, bytes.copyOfRange(12, 28),
                if (phase == Phase.RESERVED) null else bytes.copyOfRange(28, MAX_BYTES))
        }
    }
}
