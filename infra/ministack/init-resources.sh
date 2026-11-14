#!/bin/sh
set -eu

: "${AWS_ENDPOINT_URL:?AWS_ENDPOINT_URL must be set}"
: "${AWS_REGION:?AWS_REGION must be set}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID must be set}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY must be set}"
: "${RPG_ASSETS_BUCKET:?RPG_ASSETS_BUCKET must be set}"

aws_local() {
  aws --endpoint-url "$AWS_ENDPOINT_URL" --region "$AWS_REGION" "$@"
}

if bucket_error=$(aws_local s3api head-bucket --bucket "$RPG_ASSETS_BUCKET" 2>&1); then
  printf 'S3 bucket already exists: %s\n' "$RPG_ASSETS_BUCKET"
else
  case "$bucket_error" in
    *"(404)"*|*"(NoSuchBucket)"*|*"(NotFound)"*) ;;
    *) printf '%s\n' "$bucket_error" >&2; exit 1 ;;
  esac

  set -- s3api create-bucket --bucket "$RPG_ASSETS_BUCKET"
  if [ "$AWS_REGION" != us-east-1 ]; then
    set -- "$@" --create-bucket-configuration "LocationConstraint=$AWS_REGION"
  fi

  if bucket_error=$(aws_local "$@" 2>&1); then
    printf 'Created S3 bucket: %s\n' "$RPG_ASSETS_BUCKET"
  else
    # Another initializer may have created the bucket after head-bucket.
    case "$bucket_error" in
      *"(BucketAlreadyExists)"*|*"(BucketAlreadyOwnedByYou)"*)
        aws_local s3api head-bucket --bucket "$RPG_ASSETS_BUCKET"
        ;;
      *) printf '%s\n' "$bucket_error" >&2; exit 1 ;;
    esac
  fi
fi

# Domain tables belong to their future services; only check API accessibility.
aws_local dynamodb list-tables
