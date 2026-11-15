from __future__ import annotations

import pytest

pytest.importorskip("boto3")
from botocore.exceptions import ClientError, EndpointConnectionError  # noqa: E402

from app.adapters.s3_storage import S3ObjectStorage  # noqa: E402
from app.domain.errors import DependencyUnavailable  # noqa: E402


@pytest.fixture
def storage(monkeypatch) -> S3ObjectStorage:
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    return S3ObjectStorage(
        bucket="rpg-nexus-assets",
        region="us-east-1",
        endpoint_url="http://ministack:4566",
        public_endpoint_url="http://localhost:4566",
    )


def test_url_pre_assinada_usa_endpoint_publico_e_path_style(storage):
    presigned = storage.presign_upload("characters/p1/portrait", "image/png", 300)
    assert presigned.url.startswith("http://localhost:4566/rpg-nexus-assets/characters/p1/portrait?")
    assert "X-Amz-Signature=" in presigned.url and "X-Amz-Expires=300" in presigned.url
    assert presigned.method == "PUT" and presigned.headers == {"Content-Type": "image/png"}
    assert storage.presign_download("characters/p1/portrait", 60).startswith("http://localhost:4566/")


class _Head:
    def __init__(self, error: Exception) -> None:
        self.error = error

    def head_object(self, **_: object) -> None:
        raise self.error


def test_head_inexistente_retorna_none(storage):
    storage._client = _Head(ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"))
    assert storage.head("characters/x/portrait") is None


def test_s3_fora_do_ar_vira_dependency_unavailable(storage):
    storage._client = _Head(EndpointConnectionError(endpoint_url="http://ministack:4566"))
    with pytest.raises(DependencyUnavailable):
        storage.head("characters/x/portrait")
