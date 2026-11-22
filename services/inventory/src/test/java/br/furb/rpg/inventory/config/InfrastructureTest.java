package br.furb.rpg.inventory.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.Queue;

/** As filas declaradas pelo S3 usam os nomes vindos do ambiente, e não nomes fixos no código. */
class InfrastructureTest {
    @Test @DisplayName("filas, .dlq e ligações seguem os nomes configurados")
    void queueNamesComeFromConfiguration() {
        var topology=new Infrastructure().inventoryTopology("rpg.events","outra.respostas","outra.participantes");

        var queues=topology.getDeclarablesByType(Queue.class).stream()
            .collect(Collectors.toMap(Queue::getName,queue -> queue));
        assertThat(queues).containsOnlyKeys("outra.respostas","outra.respostas.dlq",
            "outra.participantes","outra.participantes.dlq");
        assertThat(queues.get("outra.participantes").getArguments())
            .containsEntry("x-dead-letter-routing-key","outra.participantes.dlq");
        assertThat(queues.get("outra.respostas").getArguments())
            .containsEntry("x-dead-letter-routing-key","outra.respostas.dlq");

        Map<String,Long> bindingsPerQueue=topology.getDeclarablesByType(Binding.class).stream()
            .collect(Collectors.groupingBy(Binding::getDestination,Collectors.counting()));
        assertThat(bindingsPerQueue).containsEntry("outra.respostas",5L).containsEntry("outra.participantes",4L);
    }
}
