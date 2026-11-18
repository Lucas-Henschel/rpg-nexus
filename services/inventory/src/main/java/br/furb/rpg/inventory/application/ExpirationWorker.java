package br.furb.rpg.inventory.application;

import br.furb.rpg.inventory.ports.SagaPort;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
class ExpirationWorker {
    private final SagaPort saga;
    ExpirationWorker(SagaPort saga) { this.saga=saga; }
    @Scheduled(fixedDelay=2000)
    void expire() { saga.expireDue(); }
}
