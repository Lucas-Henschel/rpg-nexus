#!/bin/sh
set -eu

: "${AWS_ENDPOINT_URL:?AWS_ENDPOINT_URL must be set}"
: "${AWS_REGION:?AWS_REGION must be set}"
: "${RPG_ASSETS_BUCKET:?RPG_ASSETS_BUCKET must be set}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

/bin/sh "$script_dir/init-resources.sh"
/bin/sh "$script_dir/init-resources.sh"

aws --endpoint-url "$AWS_ENDPOINT_URL" --region "$AWS_REGION" \
  s3api head-bucket --bucket "$RPG_ASSETS_BUCKET"
aws --endpoint-url "$AWS_ENDPOINT_URL" --region "$AWS_REGION" \
  dynamodb list-tables

printf 'PASS: repeated initialization, S3 bucket, and DynamoDB API verified.\n'
