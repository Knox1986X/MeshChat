package org.meshchat.lab.diagnostics

import org.junit.Assert.*
import org.junit.Test

class DiagnosticLogTest {
    @Test fun exportsOnlyReviewedCodes() {
        val log = DiagnosticLog()
        DiagnosticEvent.entries.forEach(log::record)
        val text = log.snapshot()
        DiagnosticEvent.entries.forEach { assertTrue(text.contains(it.name)) }
        assertFalse(text.contains("java.lang"))
        assertTrue(text.contains("schema=1"))
    }
    @Test fun ringBufferIsBoundedAndClearIsEffective() {
        val log = DiagnosticLog()
        repeat(10000) { log.record(DiagnosticEvent.TEST_FAILED) }
        val text = log.snapshot()
        assertEquals(256, text.lineSequence().count { it.endsWith(" TEST_FAILED") })
        assertTrue(text.contains("dropped=9744"))
        assertTrue(text.length < 12000)
        log.clear()
        assertFalse(log.snapshot().contains("TEST_FAILED"))
        assertTrue(log.snapshot().contains("dropped=0"))
    }
    @Test fun concurrentWritersDoNotCorruptSnapshot() {
        val log = DiagnosticLog()
        val threads = List(4) { Thread { repeat(1000) { log.record(DiagnosticEvent.WRAP_OK); log.snapshot() } } }
        threads.forEach { it.start() }; threads.forEach { it.join() }
        assertTrue(log.snapshot().contains("dropped=3744"))
    }
}
