# Topologia do RabbitMQ: exchange, filas (com .retry e .dlq) e ligações.
#
# Tudo vem de infra/rabbitmq/definitions.json, o mesmo arquivo que o teste de contracts/ confere
# contra os esquemas dos eventos. Fila ou ligação nova: edite o JSON, não este arquivo.
locals {
  rabbitmq = jsondecode(file("${path.module}/../rabbitmq/definitions.json"))
}

resource "rabbitmq_exchange" "this" {
  for_each = { for exchange in local.rabbitmq.exchanges : exchange.name => exchange }

  name  = each.value.name
  vhost = each.value.vhost

  settings {
    type        = each.value.type
    durable     = each.value.durable
    auto_delete = each.value.auto_delete
  }
}

resource "rabbitmq_queue" "this" {
  for_each = { for queue in local.rabbitmq.queues : queue.name => queue }

  name  = each.value.name
  vhost = each.value.vhost

  settings {
    durable     = each.value.durable
    auto_delete = each.value.auto_delete

    # O RabbitMQ 4 devolve o tipo da fila nos argumentos mesmo sem ele ter sido pedido. Sem o tipo
    # aqui, o Terraform veria diferença e recriaria a fila (perdendo as mensagens) a cada execução.
    # "classic" é o tipo padrão: é o mesmo que os serviços declaram sem dizer nada.
    arguments_json = jsonencode(merge({ "x-queue-type" = "classic" }, each.value.arguments))
  }
}

resource "rabbitmq_binding" "this" {
  # Chave "fila <- routing key": a mesma fila recebe várias routing keys.
  for_each = {
    for binding in local.rabbitmq.bindings :
    "${binding.destination} <- ${binding.routing_key}" => binding
  }

  source           = rabbitmq_exchange.this[each.value.source].name
  vhost            = each.value.vhost
  destination      = rabbitmq_queue.this[each.value.destination].name
  destination_type = each.value.destination_type
  routing_key      = each.value.routing_key
}
