package org.meshchat.lab.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class OperationGateTest {
    private class Resource(private val fail: Boolean = false) : AutoCloseable {
        var closes = 0
        override fun close() {
            closes++
            if (fail) error("synthetic cleanup failure")
        }
    }

    @Test fun cancelInvalidatesLateCallback() {
        val gate = OperationGate()
        val resource = Resource()
        val ticket = gate.start(resource)
        gate.cancel()
        var completed = false
        assertFalse(gate.complete(ticket) { completed = true })
        assertFalse(completed)
        assertEquals(1, resource.closes)
        gate.cancel()
        assertEquals(1, resource.closes)
    }

    @Test fun replacementClosesOldAndRejectsStaleTicket() {
        val gate = OperationGate()
        val first = Resource()
        val old = gate.start(first)
        val second = Resource()
        val next = gate.start(second)
        assertEquals(1, first.closes)
        assertFalse(gate.complete(old) { error("stale action") })
        assertTrue(gate.complete(next) {})
        assertEquals(1, second.closes)
    }

    @Test fun ticketCannotCrossGateBoundary() {
        val first = OperationGate()
        val second = OperationGate()
        val ticket = first.start(Resource())
        val resource = Resource()
        val valid = second.start(resource)
        assertFalse(second.complete(ticket) { error("wrong gate") })
        assertTrue(second.complete(valid) {})
        first.close()
    }

    @Test fun completionIsSingleUseAndClosesOnException() {
        val gate = OperationGate()
        val resource = Resource()
        val ticket = gate.start(resource)
        assertThrows(IllegalStateException::class.java) {
            gate.complete(ticket) { error("synthetic action failure") }
        }
        assertEquals(1, resource.closes)
        assertFalse(gate.complete(ticket) { error("replayed callback") })
    }

    @Test fun closeIsTerminal() {
        val gate = OperationGate()
        val resource = Resource()
        val ticket = gate.start(resource)
        gate.close()
        assertFalse(gate.isCurrent(ticket))
        val rejected = Resource()
        assertThrows(IllegalStateException::class.java) { gate.start(rejected) }
        assertEquals(1, rejected.closes)
        assertEquals(1, resource.closes)
    }

    @Test fun cleanupFailurePoisonsGateAndStillClosesNewResource() {
        val gate = OperationGate()
        val bad = Resource(fail = true)
        gate.start(bad)
        val rejected = Resource()
        assertThrows(IllegalStateException::class.java) { gate.start(rejected) }
        assertTrue(gate.cleanupFailed())
        assertEquals(1, bad.closes)
        assertEquals(1, rejected.closes)
    }
}
