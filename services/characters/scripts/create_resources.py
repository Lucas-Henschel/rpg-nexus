"""Cria (de forma idempotente) as tabelas DynamoDB e o bucket S3 do S2 a partir do manifesto.

É executado pelo serviço `characters-init` do docker-compose.yml da raiz. O bucket já é criado
pelo `aws-init`; aqui ele só é reaproveitado e recebe a configuração de CORS.

    python -m scripts.create_resources            # usa AWS_ENDPOINT_URL / AWS_REGION do ambiente
    python -m scripts.create_resources --wait 30  # aguarda o MiniStack ficar disponível
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from boto3.session import Session
from botocore.exceptions import ClientError, EndpointConnectionError

from app.config import Settings


def _wait_for(client, seconds: int) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            client.list_tables(Limit=1)
            return
        except EndpointConnectionError:
            if time.monotonic() > deadline:
                raise
            print("… aguardando DynamoDB", flush=True)
            time.sleep(2)


def create_tables(client, manifest: dict, settings: Settings) -> None:
    names = {
        "TABLE_CHARACTERS": settings.table_characters,
        "TABLE_INBOX": settings.table_inbox,
        "TABLE_OUTBOX": settings.table_outbox,
        "TABLE_READ_MODEL": settings.table_read_model,
    }
    for table in manifest["dynamodb"]["tables"]:
        name = names.get(table.get("envOverride", ""), table["name"])
        params = {
            "TableName": name,
            "KeySchema": table["keySchema"],
            "AttributeDefinitions": table["attributeDefinitions"],
            "BillingMode": table["billingMode"],
        }
        if table.get("globalSecondaryIndexes"):
            params["GlobalSecondaryIndexes"] = table["globalSecondaryIndexes"]
        try:
            client.create_table(**params)
            client.get_waiter("table_exists").wait(TableName=name)
            print(f"✔ tabela {name} criada")
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ResourceInUseException":
                raise
            print(f"• tabela {name} já existe")
        if table.get("ttlAttribute"):
            try:
                client.update_time_to_live(
                    TableName=name, TimeToLiveSpecification={"Enabled": True, "AttributeName": table["ttlAttribute"]}
                )
            except ClientError as exc:  # já habilitado, ou não suportado pelo emulador
                print(f"  (TTL de {name}: {exc.response['Error']['Code']})")


def create_bucket(client, manifest: dict, settings: Settings) -> None:
    bucket = settings.s3_bucket
    try:
        if settings.aws_region == "us-east-1":
            client.create_bucket(Bucket=bucket)
        else:
            client.create_bucket(Bucket=bucket, CreateBucketConfiguration={"LocationConstraint": settings.aws_region})
        print(f"✔ bucket {bucket} criado")
    except ClientError as exc:
        if exc.response["Error"]["Code"] not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
            raise
        print(f"• bucket {bucket} já existe")
    cors = manifest["s3"].get("cors")
    if cors:
        origins = os.getenv("CORS_ORIGINS")
        rule = {**cors, "AllowedOrigins": [o.strip() for o in origins.split(",")] if origins else cors["AllowedOrigins"]}
        try:
            client.put_bucket_cors(Bucket=bucket, CORSConfiguration={"CORSRules": [rule]})
            print(f"  CORS do bucket configurado para {rule['AllowedOrigins']}")
        except ClientError as exc:
            print(f"  (CORS não aplicado: {exc.response['Error']['Code']})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--wait", type=int, default=0, help="segundos para aguardar o endpoint AWS")
    parser.add_argument("--manifest", type=Path, default=None)
    args = parser.parse_args()

    settings = Settings.from_env()
    manifest = json.loads((args.manifest or settings.manifest_path).read_text(encoding="utf-8"))
    session = Session()
    dynamodb = session.client("dynamodb", region_name=settings.aws_region, endpoint_url=settings.dynamodb_endpoint_url)
    s3 = session.client("s3", region_name=settings.aws_region, endpoint_url=settings.s3_endpoint_url)
    if args.wait:
        _wait_for(dynamodb, args.wait)
    create_tables(dynamodb, manifest, settings)
    create_bucket(s3, manifest, settings)
    return 0


if __name__ == "__main__":
    sys.exit(main())
