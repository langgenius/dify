from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from configs import dify_config
from core.db.session_factory import session_factory
from repositories import sqlalchemy_knowledge_fs_capability_issuance_auditor
from services import knowledge_fs_capability
from services.knowledge_fs import lifecycle_remote_http, remote_registry


def test_configured_lifecycle_remote_assembles_capability_v2_http_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    maker = MagicMock(name="session-maker")
    auditor = MagicMock(name="capability-auditor")
    issuer = MagicMock(name="capability-issuer")
    client = MagicMock(name="lifecycle-http-client")
    captured: dict[str, object] = {}

    monkeypatch.setattr(dify_config, "KNOWLEDGE_FS_BASE_URL", "https://knowledge-fs.test")
    monkeypatch.setattr(dify_config, "KNOWLEDGE_FS_TIMEOUT_SECONDS", 4.5)
    monkeypatch.setattr(session_factory, "get_session_maker", lambda: maker)
    monkeypatch.setattr(
        sqlalchemy_knowledge_fs_capability_issuance_auditor,
        "SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor",
        lambda received: auditor if received is maker else None,
    )
    monkeypatch.setattr(
        knowledge_fs_capability,
        "create_configured_knowledge_fs_capability_issuer",
        lambda *, audit: issuer if audit is auditor else None,
    )

    def create_client(**kwargs: object) -> object:
        captured.update(kwargs)
        return client

    monkeypatch.setattr(lifecycle_remote_http, "HTTPKnowledgeFSLifecycleRemoteClient", create_client)

    assert remote_registry.create_configured_knowledge_fs_lifecycle_remote() is client
    assert captured == {
        "base_url": "https://knowledge-fs.test",
        "issuer": issuer,
        "timeout_seconds": 4.5,
    }


def test_lifecycle_remote_assembly_fails_closed_without_endpoint_or_capability_issuer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dify_config, "KNOWLEDGE_FS_BASE_URL", None)
    with pytest.raises(RuntimeError, match="BASE_URL"):
        remote_registry.create_configured_knowledge_fs_lifecycle_remote()

    monkeypatch.setattr(dify_config, "KNOWLEDGE_FS_BASE_URL", "https://knowledge-fs.test")
    monkeypatch.setattr(
        knowledge_fs_capability,
        "create_configured_knowledge_fs_capability_issuer",
        lambda *, audit: None,
    )
    with pytest.raises(RuntimeError, match="Capability v2"):
        remote_registry.create_configured_knowledge_fs_lifecycle_remote()


def test_explicit_lifecycle_remote_factory_remains_available_for_isolated_process_tests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    remote = MagicMock(name="remote")
    monkeypatch.setattr(remote_registry, "_remote_factory", None)

    remote_registry.configure_knowledge_fs_lifecycle_remote_factory(lambda: remote)

    assert remote_registry.get_knowledge_fs_lifecycle_remote() is remote
