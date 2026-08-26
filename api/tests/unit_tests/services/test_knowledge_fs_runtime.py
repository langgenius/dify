from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.knowledge_fs import runtime
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError


def test_runtime_fails_closed_when_the_remote_endpoint_is_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime.dify_config, "KNOWLEDGE_FS_BASE_URL", None)

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not configured"):
        runtime.create_knowledge_fs_runtime(MagicMock())


def test_process_runtime_is_built_once_for_the_application_session_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_maker = MagicMock(name="session_maker")
    built_runtime = SimpleNamespace(component="runtime")
    factory = MagicMock(return_value=built_runtime)
    monkeypatch.setattr(runtime, "create_knowledge_fs_runtime", factory)

    first = runtime.get_knowledge_fs_runtime(session_maker)
    second = runtime.get_knowledge_fs_runtime(session_maker)

    assert first is built_runtime
    assert second is built_runtime
    factory.assert_called_once_with(session_maker)


def test_runtime_wires_one_shared_authorization_and_remote_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime.dify_config, "KNOWLEDGE_FS_BASE_URL", "https://knowledge-fs.test")
    monkeypatch.setattr(runtime.dify_config, "KNOWLEDGE_FS_TIMEOUT_SECONDS", 12.0)
    monkeypatch.setattr(runtime.dify_config, "KNOWLEDGE_FS_PRODUCT_MAX_RESPONSE_BYTES", 4096)

    factory_names = (
        "DifyKnowledgeFSProductRBACPort",
        "HTTPKnowledgeFSProductRemoteClient",
        "KnowledgeFSAppAdmissionService",
        "KnowledgeFSAppBindingManagementService",
        "KnowledgeFSAppExecutionCapabilityService",
        "KnowledgeFSBatchCapabilityBroker",
        "KnowledgeFSCapabilityBroker",
        "KnowledgeFSControlPlaneService",
        "KnowledgeFSControlSpaceCommandService",
        "KnowledgeFSServiceApiAuthorizationService",
        "KnowledgeFSDataFacade",
        "KnowledgeFSProductApplicationService",
        "KnowledgeFSProductService",
        "KnowledgeFSRevocationCommandProducer",
        "KnowledgeFSWorkspaceCutoverService",
        "KnowledgeFSWorkspaceGreenfieldInitializer",
        "SQLKnowledgeFSAppCatalog",
        "SQLKnowledgeFSWorkspaceMemberPort",
        "SQLKnowledgeFSWorkspaceRuntimeGate",
        "SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor",
        "create_configured_knowledge_fs_capability_issuer",
        "get_knowledge_fs_lifecycle_remote",
    )
    factories: dict[str, MagicMock] = {}
    for name in factory_names:
        factory = MagicMock(name=name)
        factory.return_value = SimpleNamespace(component=name)
        factories[name] = factory
        monkeypatch.setattr(runtime, name, factory)

    session_maker = MagicMock(name="session_maker")
    result = runtime.create_knowledge_fs_runtime(session_maker)

    assert result.application is factories["KnowledgeFSProductApplicationService"].return_value
    assert result.app_admission is factories["KnowledgeFSAppAdmissionService"].return_value
    assert result.app_bindings is factories["KnowledgeFSAppBindingManagementService"].return_value
    assert result.app_capabilities is factories["KnowledgeFSAppExecutionCapabilityService"].return_value
    assert result.broker is factories["KnowledgeFSCapabilityBroker"].return_value
    assert result.control_plane is factories["KnowledgeFSControlPlaneService"].return_value
    assert result.service_api_authorization is factories["KnowledgeFSServiceApiAuthorizationService"].return_value
    assert result.facade is factories["KnowledgeFSDataFacade"].return_value

    factories["HTTPKnowledgeFSProductRemoteClient"].assert_called_once_with(
        base_url="https://knowledge-fs.test",
        timeout_seconds=12.0,
        max_response_bytes=4096,
    )
    factories["create_configured_knowledge_fs_capability_issuer"].assert_called_once_with(
        audit=factories["SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor"].return_value
    )
    assert (
        factories["KnowledgeFSProductService"].call_args.kwargs["cutover_gate"]
        is factories["SQLKnowledgeFSWorkspaceRuntimeGate"].return_value
    )
    factories["KnowledgeFSWorkspaceCutoverService"].assert_called_once_with(
        session_maker,
        remote_factory=factories["get_knowledge_fs_lifecycle_remote"],
    )
    factories["KnowledgeFSWorkspaceGreenfieldInitializer"].assert_called_once_with(
        session_maker,
        cutover=factories["KnowledgeFSWorkspaceCutoverService"].return_value,
    )
    factories["SQLKnowledgeFSWorkspaceRuntimeGate"].assert_called_once_with(
        session_maker,
        initializer=factories["KnowledgeFSWorkspaceGreenfieldInitializer"].return_value,
    )
    assert (
        factories["KnowledgeFSProductApplicationService"].call_args.kwargs["rbac"]
        is factories["DifyKnowledgeFSProductRBACPort"].return_value
    )
    assert factories["KnowledgeFSAppExecutionCapabilityService"].call_args.kwargs["admission"] is result.app_admission
