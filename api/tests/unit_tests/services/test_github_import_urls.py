"""Check URL selection at the legacy YAML import download boundary."""

import httpx
import pytest
from sqlalchemy.orm import Session

from core.file import remote_fetcher
from models import Account
from services.app_dsl_service import AppDslService
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService


@pytest.mark.parametrize("importer", ["app", "rag-pipeline"])
@pytest.mark.parametrize(
    ("url", "download_url"),
    [
        ("https://example.com/download", "https://example.com/download"),
        (
            "https://github.com/org/repo/blob/main/templates/blob/flow.yaml?source=/blob/file",
            "https://raw.githubusercontent.com/org/repo/main/templates/blob/flow.yaml?source=/blob/file",
        ),
        (
            "https://github.com/blob/repo/blob/main/flow.yml",
            "https://raw.githubusercontent.com/blob/repo/main/flow.yml",
        ),
        (
            "https://github.com/org/repo/raw/main/templates/blob/flow.yaml",
            "https://github.com/org/repo/raw/main/templates/blob/flow.yaml",
        ),
        (
            "https://github.com/user-attachments/files/123/flow.yaml",
            "https://github.com/user-attachments/files/123/flow.yaml",
        ),
    ],
)
def test_yaml_import_preserves_github_url_components(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session, importer: str, url: str, download_url: str
) -> None:
    requested: list[str] = []

    def fetch(method: str, url: str, **_kwargs: object) -> httpx.Response:
        requested.append(url)
        # An empty successful response stops after URL selection, before resource creation.
        return httpx.Response(200, request=httpx.Request(method, url), content=b"")

    monkeypatch.setattr(remote_fetcher, "make_request", fetch)
    account = Account(name="Test Account", email="test@example.com")
    if importer == "app":
        result = AppDslService(session=unbound_session).import_app(
            account=account, import_mode="yaml-url", yaml_url=url
        )
    else:
        result = RagPipelineDslService(session=unbound_session).import_rag_pipeline(
            account=account, import_mode="yaml-url", yaml_url=url
        )

    assert requested == [download_url]
    assert result.error == "Empty content from url"
    assert not unbound_session.in_transaction()
