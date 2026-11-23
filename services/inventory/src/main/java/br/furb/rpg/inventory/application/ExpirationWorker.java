package br.furb.rpg.inventory.application;

import br.furb.rpg.inventory.ports.SagaPort;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="inventory.run-schedulers", havingValue="true", matchIfMissing=true)
class ExpirationWorker {
    private final SagaPort saga;
    ExpirationWorker(SagaPort saga) { this.saga=saga; }
    @Scheduled(fixedDelay=2000)
    void expire() { saga.expireDue(); }
}
