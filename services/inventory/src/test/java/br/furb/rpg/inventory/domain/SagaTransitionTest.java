package br.furb.rpg.inventory.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class SagaTransitionTest {
    private final Instant now = Instant.parse("2026-11-20T00:00:00Z");

    private Acquisition acquisition(Acquisition.Status status) {
        return new Acquisition("op-1", "camp-1", "user-1", "char-1", "item-1", 20,
            status, 0, now.plusSeconds(60));
    }

    @Test void externalApprovalRequestsMoney() {
        var decision = SagaTransition.decide(acquisition(Acquisition.Status.VALIDATING_EXTERNAL),
            "rpg.external.validation-succeeded.v1", now);
        assertThat(decision.next()).isEqualTo(Acquisition.Status.WAITING_MONEY);
        assertThat(decision.effect()).isEqualTo(SagaTransition.Effect.REQUEST_MONEY);
    }

    @Test void externalFailureReleasesStock() {
        var decision = SagaTransition.decide(acquisition(Acquisition.Status.VALIDATING_EXTERNAL),
            "rpg.external.validation-failed.v1", now);
        assertThat(decision.next()).isEqualTo(Acquisition.Status.COMPENSATED);
        assertThat(decision.effect()).isEqualTo(SagaTransition.Effect.RELEASE_STOCK);
    }

    @Test void moneyIsIgnoredBeforeExternalApproval() {
        var decision = SagaTransition.decide(acquisition(Acquisition.Status.VALIDATING_EXTERNAL),
            "rpg.money.debited.v1", now);
        assertThat(decision.effect()).isEqualTo(SagaTransition.Effect.NONE);
    }

    @Test void lateDebitIsRefunded() {
        var expired = acquisition(Acquisition.Status.EXPIRED);
        var decision = SagaTransition.decide(expired, "rpg.money.debited.v1", now);
        assertThat(decision.effect()).isEqualTo(SagaTransition.Effect.REFUND_MONEY);
    }
}
