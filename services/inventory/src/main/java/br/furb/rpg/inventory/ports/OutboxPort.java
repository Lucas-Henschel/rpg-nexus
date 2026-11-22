package br.furb.rpg.inventory.ports;

import java.util.List;

public interface OutboxPort {
    record PendingEvent(String id, String route, String envelope, String traceparent) {}
    List<PendingEvent> pendingEvents();
    void markPublished(String id);
}
