"""Armazenamento de retratos no S3 (ou emulador compatível, ex.: MiniStack).

Dois clientes boto3:
* ``_client`` usa o endpoint interno (ex.: http://ministack:4566) para operações do backend;
* ``_presigner`` assina URLs com o endpoint PÚBLICO (ex.: http://localhost:4566), acessível pelo
  navegador. Sem isso, a URL pré-assinada apontaria para um hostname que só existe na rede Docker.
"""

from __future__ import annotations

from typing import Any

from boto3.session import Session
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.application.ports import ObjectInfo, PresignedRequest
from app.domain.errors import DependencyUnavailable


class S3ObjectStorage:
    def __init__(
        self,
        *,
        bucket: str,
        region: str,
        endpoint_url: str | None,
        public_endpoint_url: str | None,
        force_path_style: bool = True,
    ) -> None:
        config = Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if force_path_style else "auto"},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=2,
            read_timeout=10,
        )
        session = Session()
        self._bucket = bucket
        self._client = session.client("s3", region_name=region, endpoint_url=endpoint_url, config=config)
        self._presigner = session.client(
            "s3", region_name=region, endpoint_url=public_endpoint_url or endpoint_url, config=config
        )

    def _guard(self, fn: Any, **kwargs: Any) -> Any:
        try:
            return fn(**kwargs)
        except BotoCoreError as exc:
            raise DependencyUnavailable(f"S3 indisponível: {exc}") from exc

    def ping(self) -> None:
        self._guard(self._client.head_bucket, Bucket=self._bucket)

    def presign_upload(self, key: str, content_type: str, expires_in: int) -> PresignedRequest:
        url = self._presigner.generate_presigned_url(
            "put_object",
            Params={"Bucket": self._bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires_in,
            HttpMethod="PUT",
        )
        return PresignedRequest(url=url, method="PUT", headers={"Content-Type": content_type}, expires_in=expires_in, key=key)

    def presign_download(self, key: str, expires_in: int) -> str:
        return self._presigner.generate_presigned_url(
            "get_object", Params={"Bucket": self._bucket, "Key": key}, ExpiresIn=expires_in
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._guard(self._client.put_object, Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    def head(self, key: str) -> ObjectInfo | None:
        try:
            resp = self._guard(self._client.head_object, Bucket=self._bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return ObjectInfo(
            key=key, size=int(resp["ContentLength"]), content_type=resp.get("ContentType", "application/octet-stream")
        )

    def read_prefix(self, key: str, length: int) -> bytes:
        resp = self._guard(self._client.get_object, Bucket=self._bucket, Key=key, Range=f"bytes=0-{length - 1}")
        return resp["Body"].read(length)

    def get(self, key: str) -> tuple[bytes, str]:
        resp = self._guard(self._client.get_object, Bucket=self._bucket, Key=key)
        return resp["Body"].read(), resp.get("ContentType", "application/octet-stream")

    def delete(self, key: str) -> None:
        self._guard(self._client.delete_object, Bucket=self._bucket, Key=key)
