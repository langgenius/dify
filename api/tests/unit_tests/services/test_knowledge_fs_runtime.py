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


def test_runtime_wires_one_shared_authorization_and_remote_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime.dify_config, "KNOWLEDGE_FS_BASE_URL", "https://knowledge-fs.test")
    monkeypatch.setattr(runtime.dify_config, "KNOWLEDGE_FS_TIMEOUT_SECONDS", 12.0)
    monkeypatch.setattr(runtime.dify_config, "KNOWLEDGE_FS_PRODUCT_MAX_RESPONSE_BYTES", 4096)

    factory_names = (
        "DifyKnowledgeFSBillingPort",
        "DifyKnowledgeFSProductRBACPort",
        "DifyKnowledgeFSWeightedRateLimitPort",
        "HTTPKnowledgeFSProductRemoteClient",
        "KnowledgeFSAppAdmissionService",
        "KnowledgeFSAppBindingManagementService",
        "KnowledgeFSAppExecutionCapabilityService",
        "KnowledgeFSBatchCapabilityBroker",
        "KnowledgeFSCapabilityBroker",
        "KnowledgeFSControlPlaneService",
        "KnowledgeFSControlSpaceCommandService",
        "KnowledgeFSCredentialService",
        "KnowledgeFSDataFacade",
        "KnowledgeFSDirectOperationAdmissionService",
        "KnowledgeFSOperationAdmissionService",
        "KnowledgeFSProductApplicationService",
        "KnowledgeFSProductService",
        "KnowledgeFSRevocationCommandProducer",
        "LoggingKnowledgeFSRateLimitAudit",
        "SQLKnowledgeFSAppCatalog",
        "SQLKnowledgeFSWorkspaceMemberPort",
        "SQLKnowledgeFSWorkspaceRuntimeGate",
        "SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor",
        "create_configured_knowledge_fs_capability_issuer",
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
    assert result.credentials is factories["KnowledgeFSCredentialService"].return_value
    assert result.direct_operation_admission is factories["KnowledgeFSDirectOperationAdmissionService"].return_value
    assert result.facade is factories["KnowledgeFSDataFacade"].return_value
    assert result.operation_admission is factories["KnowledgeFSOperationAdmissionService"].return_value

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
    assert (
        factories["KnowledgeFSProductApplicationService"].call_args.kwargs["rbac"]
        is factories["DifyKnowledgeFSProductRBACPort"].return_value
    )
    assert factories["KnowledgeFSAppExecutionCapabilityService"].call_args.kwargs["admission"] is result.app_admission
