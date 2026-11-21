package org.meshchat.lab.security

/**
 * Single-owner-thread operation lifecycle; contains no keys or Android classes.
 * Tickets are identity-bound to this gate; stale callbacks never run their action.
 * A cleanup failure poisons the gate rather than silently starting another task.
 */
internal class OperationGate : AutoCloseable {
    class Ticket internal constructor()
    private class Entry(val ticket: Ticket, val resource: AutoCloseable)
    private var active: Entry? = null
    private var closed = false
    private var poisoned = false

    fun start(resource: AutoCloseable): Ticket {
        if (closed || poisoned) {
            resource.close()
            error("operation gate unavailable")
        }
        cancel()
        if (poisoned) {
            resource.close()
            error("operation cleanup failed")
        }
        return Ticket().also { active = Entry(it, resource) }
    }

    fun isCurrent(ticket: Ticket): Boolean = !closed && !poisoned && active?.ticket === ticket

    fun complete(ticket: Ticket, action: () -> Unit): Boolean {
        if (!isCurrent(ticket)) return false
        val entry = checkNotNull(active)
        active = null // Invalidate before invoking caller code or closing resource.
        try {
            action()
        } finally {
            dispose(entry.resource)
        }
        return true
    }

    fun cancel() {
        val entry = active
        active = null // cancel()/close() may synchronously cause a late callback.
        if (entry != null) dispose(entry.resource)
    }

    fun cleanupFailed(): Boolean = poisoned

    private fun dispose(resource: AutoCloseable) {
        try {
            resource.close()
        } catch (_: Exception) {
            poisoned = true
        }
    }

    override fun close() {
        closed = true
        cancel()
    }
}
