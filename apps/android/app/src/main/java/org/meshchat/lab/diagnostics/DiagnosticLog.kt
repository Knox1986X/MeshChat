package org.meshchat.lab.diagnostics

/** No String/Throwable/bytes input: only reviewed public event codes cross this boundary. */
enum class DiagnosticEvent {
    APP_OPENED, PAUSED, SCREEN_OFF, START_STRONGBOX, START_TEE,
    PRIVATE_DIRECTORY_FAILED, NATIVE_LOAD_FAILED, HARDWARE_READY, WRAP_OK,
    UNWRAP_OK, NATIVE_PROBE_STARTED, NATIVE_PROBE_OK, TEST_FAILED,
    HARDWARE_SETUP_FAILED, WRAP_AUTH_FAILED, UNWRAP_SETUP_FAILED, UNWRAP_AUTH_FAILED,
    KEY_ROUNDTRIP_MISMATCH, NATIVE_GATE_FAILED, NATIVE_PROBE_FAILED,
    CANCELLED, SHUTDOWN_FAILED, CLEANUP_OK, CLEANUP_FAILED,
}

/** RAM only, no wall-clock/device/account identifiers. A process death loses this log. */
class DiagnosticLog {
    private val events = ArrayDeque<DiagnosticEvent>()
    private var dropped = 0L

    @Synchronized fun record(event: DiagnosticEvent) {
        if (events.size == CAPACITY) { events.removeFirst(); dropped++ }
        events.addLast(event)
    }

    @Synchronized fun clear() { events.clear(); dropped = 0 }

    @Synchronized fun snapshot(): String = buildString {
        append("MeshChat diagnostic schema=1\nNOT A MESSENGER; RAM-only allowlisted events\n")
        append("No keys, messages, aliases, paths, IPs, stack traces or device IDs collected.\n")
        append("No crash recovery: process death loses events. No automatic upload.\n")
        append("dropped=").append(dropped).append('\n')
        events.forEachIndexed { index, event -> append(index + 1).append(' ').append(event.name).append('\n') }
    }

    companion object {
        const val CAPACITY = 256
    }
}
