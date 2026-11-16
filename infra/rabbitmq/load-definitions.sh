#!/bin/sh
# Applies definitions.json (exchange, queues and bindings) through the RabbitMQ management API.
# Importing is additive: it never deletes queues or messages, and running it again changes nothing.
# Not loaded at boot (load_definitions) because then RabbitMQ skips creating the
# RABBITMQ_DEFAULT_USER user on an empty volume.
set -eu

: "${RABBITMQ_MANAGEMENT_URL:?RABBITMQ_MANAGEMENT_URL must be set}"
: "${RABBITMQ_USER:?RABBITMQ_USER must be set}"
: "${RABBITMQ_PASSWORD:?RABBITMQ_PASSWORD must be set}"

definitions="${RABBITMQ_DEFINITIONS:-/work/infra/rabbitmq/definitions.json}"

# The RabbitMQ health check passes before the management plugin opens its HTTP port.
attempt=1
until curl --silent --fail --user "$RABBITMQ_USER:$RABBITMQ_PASSWORD" \
  "$RABBITMQ_MANAGEMENT_URL/api/overview" > /dev/null; do
  if [ "$attempt" -ge 30 ]; then
    printf 'RabbitMQ management API not reachable at %s\n' "$RABBITMQ_MANAGEMENT_URL" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

# A queue that already exists with different arguments makes the import fail with RabbitMQ's message.
curl --silent --show-error --fail-with-body --user "$RABBITMQ_USER:$RABBITMQ_PASSWORD" \
  --header "Content-Type: application/json" \
  --data-binary "@$definitions" \
  "$RABBITMQ_MANAGEMENT_URL/api/definitions"

printf 'Applied RabbitMQ definitions: %s\n' "$definitions"
