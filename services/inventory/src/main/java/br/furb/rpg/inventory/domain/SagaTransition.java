package br.furb.rpg.inventory.domain;

import br.furb.rpg.inventory.domain.Acquisition.Status;
import java.time.Instant;

/** Pure state rules. Persistence checks the version and applies all effects atomically. */
public final class SagaTransition {
    private SagaTransition() {}
    public enum Effect { NONE, REQUEST_EXTERNAL, REQUEST_MONEY, DELIVER_ITEM, RELEASE_STOCK, REFUND_MONEY }
    public record Decision(Status next, Effect effect) {}

    public static Decision decide(Acquisition acquisition, String eventType, Instant now) {
        Status current = acquisition.status();
        if (current == Status.COMPLETED || current == Status.REJECTED)
            return new Decision(current, Effect.NONE);
        if ((current == Status.COMPENSATED || current == Status.EXPIRED)
                && eventType.equals("rpg.money.debited.v1"))
            return new Decision(current, Effect.REFUND_MONEY);
        if (current == Status.COMPENSATED || current == Status.EXPIRED)
            return new Decision(current, Effect.NONE);
        if (!acquisition.deadlineAt().isAfter(now)) return new Decision(Status.EXPIRED, Effect.RELEASE_STOCK);
        // 1º passo: o S2 confere o personagem e reserva espaço na mochila.
        if (current == Status.VALIDATING_CHARACTER) {
            if (eventType.equals("rpg.character.validated.v1"))
                return new Decision(Status.VALIDATING_EXTERNAL, Effect.REQUEST_EXTERNAL);
            if (eventType.equals("rpg.character.rejected.v1"))
                return new Decision(Status.REJECTED, Effect.RELEASE_STOCK);
        }
        if (current == Status.VALIDATING_EXTERNAL) {
            if (eventType.equals("rpg.external.validation-succeeded.v1"))
                return new Decision(Status.WAITING_MONEY, Effect.REQUEST_MONEY);
            if (eventType.equals("rpg.external.validation-failed.v1"))
                return new Decision(Status.COMPENSATED, Effect.RELEASE_STOCK);
        }
        if (current == Status.WAITING_MONEY) {
            if (eventType.equals("rpg.money.debited.v1"))
                return new Decision(Status.COMPLETED, Effect.DELIVER_ITEM);
            if (eventType.equals("rpg.money.debit-rejected.v1"))
                return new Decision(Status.COMPENSATED, Effect.RELEASE_STOCK);
        }
        return new Decision(current, Effect.NONE);
    }
}
