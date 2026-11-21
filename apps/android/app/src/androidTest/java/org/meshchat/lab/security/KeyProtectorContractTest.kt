package org.meshchat.lab.security

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Instrumented OPERATION/FORMAT tests with PUBLIC SYNTHETIC SOFTWARE JCA keys.
 * They deliberately do not test StrongBox, biometric enforcement or AndroidKeyStore.
 * No real user keys, no production aliases, no authentication bypass in adapter.
 */
@RunWith(AndroidJUnit4::class)
class KeyProtectorContractTest {
    private fun cipher(mode: Int, iv: ByteArray? = null): Cipher {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val publicTestKey = SecretKeySpec(ByteArray(32) { 42 }, "AES")
        if (iv == null) cipher.init(mode, publicTestKey)
        else cipher.init(mode, publicTestKey, GCMParameterSpec(128, iv))
        return cipher
    }

    private fun wrap(aad: ByteArray, input: ByteArray): ByteArray =
        AndroidKeyProtector.WrapOperation(cipher(Cipher.ENCRYPT_MODE), aad)
            .finishConsumingKeyAfterAuthentication(input)

    private fun unwrap(aad: ByteArray, blob: ByteArray): AndroidKeyProtector.UnwrapOperation =
        AndroidKeyProtector.UnwrapOperation(
            cipher(Cipher.DECRYPT_MODE, blob.copyOfRange(1, 13)), aad,
            blob.copyOfRange(13, blob.size),
        )

    @Test fun wrapIsBoundedAndConsumesKey() {
        val secret = ByteArray(32) { 7 }
        val blob = wrap(byteArrayOf(9), secret)
        assertEquals(61, blob.size)
        assertEquals(1.toByte(), blob[0])
        assertArrayEquals(ByteArray(32), secret)
        val operation = unwrap(byteArrayOf(9), blob)
        val recovered = operation.finishAfterAuthentication()
        try {
            assertArrayEquals(ByteArray(32) { 7 }, recovered)
        } finally {
            recovered.fill(0)
        }
        val error = assertThrows(AndroidKeyProtector.ProtectionException::class.java) {
            operation.finishAfterAuthentication()
        }
        assertEquals(AndroidKeyProtector.Failure.OPERATION_CLOSED, error.failure)
    }

    @Test fun wrongAadAndTamperedCiphertextDoNotReturnKey() {
        val blob = wrap(byteArrayOf(9), ByteArray(32) { 7 })
        val wrongAad = unwrap(byteArrayOf(8), blob)
        assertThrows(AndroidKeyProtector.ProtectionException::class.java) {
            wrongAad.finishAfterAuthentication()
        }
        val modified = blob.copyOf().also { it[20] = (it[20].toInt() xor 1).toByte() }
        val wrongTag = unwrap(byteArrayOf(9), modified)
        assertThrows(AndroidKeyProtector.ProtectionException::class.java) {
            wrongTag.finishAfterAuthentication()
        }
    }

    @Test fun invalidKeyLengthIsConsumedAndClosesOperation() {
        val operation = AndroidKeyProtector.WrapOperation(cipher(Cipher.ENCRYPT_MODE), byteArrayOf(9))
        val invalid = ByteArray(31) { 7 }
        assertThrows(AndroidKeyProtector.ProtectionException::class.java) {
            operation.finishConsumingKeyAfterAuthentication(invalid)
        }
        assertArrayEquals(ByteArray(31), invalid)
        val next = ByteArray(32) { 8 }
        assertThrows(AndroidKeyProtector.ProtectionException::class.java) {
            operation.finishConsumingKeyAfterAuthentication(next)
        }
        assertArrayEquals(ByteArray(32), next)
    }

    @Test fun cancelledOperationCannotBeUsedAndInputStillWiped() {
        val operation = AndroidKeyProtector.WrapOperation(cipher(Cipher.ENCRYPT_MODE), byteArrayOf(9))
        operation.close()
        val secret = ByteArray(32) { 7 }
        assertThrows(AndroidKeyProtector.ProtectionException::class.java) {
            operation.finishConsumingKeyAfterAuthentication(secret)
        }
        assertArrayEquals(ByteArray(32), secret)
    }

    @Test fun malformedWrapperIsRejectedBeforeKeystoreAccess() {
        val protector = AndroidKeyProtector("meshchat.lab.wrap.v1." + "0".repeat(32))
        for (size in listOf(0, 1, 12, 60, 62, 4096)) {
            val error = assertThrows(AndroidKeyProtector.ProtectionException::class.java) {
                protector.beginUnwrap(ByteArray(16), ByteArray(size))
            }
            assertEquals(AndroidKeyProtector.Failure.INVALID_INPUT, error.failure)
        }
        val error = assertThrows(AndroidKeyProtector.ProtectionException::class.java) {
            protector.beginUnwrap(ByteArray(16), ByteArray(61)) // unsupported version0
        }
        assertEquals(AndroidKeyProtector.Failure.INVALID_INPUT, error.failure)
    }
}
