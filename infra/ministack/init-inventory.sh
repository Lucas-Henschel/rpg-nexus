#!/bin/sh
set -eu

: "${AWS_ENDPOINT_URL:?}"
: "${AWS_REGION:?}"

for name in items stocks inventory acquisition_sagas inventory_inbox inventory_outbox shops shop_items campaign_members saga_history; do
  table="inventory_$name"
  if aws --endpoint-url "$AWS_ENDPOINT_URL" --region "$AWS_REGION" dynamodb describe-table --table-name "$table" >/dev/null 2>&1; then
    printf 'DynamoDB table already exists: %s\n' "$table"
  else
    aws --endpoint-url "$AWS_ENDPOINT_URL" --region "$AWS_REGION" dynamodb create-table \
      --table-name "$table" \
      --attribute-definitions AttributeName=id,AttributeType=S \
      --key-schema AttributeName=id,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST
    aws --endpoint-url "$AWS_ENDPOINT_URL" --region "$AWS_REGION" dynamodb wait table-exists --table-name "$table"
  fi
done
