"""Infrastructure-free contract tests for common channel management."""

import ast
from pathlib import Path

import pytest

from core.human_input_v2 import channel_management
from core.human_input_v2.channel_management import (
    ChannelCapability,
    ChannelHandlerRegistry,
    ChannelKind,
    ChannelOperationResult,
    ChannelProvider,
    ChannelRef,
    ChannelScope,
    ChannelScopeKind,
    ChannelStatus,
    ChannelTestResult,
    ChannelView,
    DingTalkIMCandidate,
    DuplicateChannelHandlerError,
    FeishuIMCandidate,
    IMChannelSummary,
    IMChannelTestSummary,
    NewSecret,
    ResendChannelSummary,
    ResendChannelTestSummary,
    SlackIMCandidate,
)
from core.human_input_v2.im_integration import EncryptedCredentials
from core.human_input_v2.shared import IntegrationId, NormalizedEmail, UtcTimestamp


def test_channel_ref_rejects_kind_provider_mismatch() -> None:
    with pytest.raises(ValueError, match="do not match"):
        ChannelRef(ChannelKind.EMAIL, ChannelProvider.SLACK)


@pytest.mark.parametrize("provider", ["lark", "ms_teams", "we_com"])
def test_management_contract_does_not_define_unsupported_im_providers(provider: str) -> None:
    with pytest.raises(ValueError):
        ChannelProvider(provider)


def test_registry_rejects_duplicate_registration() -> None:
    class Handler:
        ref = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)

    with pytest.raises(DuplicateChannelHandlerError):
        ChannelHandlerRegistry((Handler(), Handler()))  # type: ignore[arg-type]


def test_registry_resolves_one_handler_per_supported_complete_channel_ref() -> None:
    class Handler:
        def __init__(self, ref: ChannelRef) -> None:
            self.ref = ref

    refs = (
        ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND),
        ChannelRef(ChannelKind.IM, ChannelProvider.SLACK),
        ChannelRef(ChannelKind.IM, ChannelProvider.FEISHU),
        ChannelRef(ChannelKind.IM, ChannelProvider.DING_TALK),
    )
    handlers = tuple(Handler(ref) for ref in refs)
    registry = ChannelHandlerRegistry(handlers)  # type: ignore[arg-type]

    assert len(registry.handlers()) == 4
    assert all(registry.resolve(ref) is handler for ref, handler in zip(refs, handlers))
    assert {handler.ref for handler in registry.handlers()} == set(refs)


def test_plaintext_secret_repr_is_redacted() -> None:
    assert "top-secret" not in repr(NewSecret("top-secret"))
    assert "ciphertext" not in repr(EncryptedCredentials.from_mapping({"secret": "ciphertext"}))


def test_im_candidates_require_new_secrets_and_do_not_export_retention() -> None:
    assert not hasattr(channel_management, "RetainSecret")

    with pytest.raises(ValueError, match="app_secret"):
        FeishuIMCandidate("app", "retain")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="verification_token"):
        FeishuIMCandidate("app", NewSecret("secret"), verification_token="retain")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="client_secret"):
        SlackIMCandidate("client", "retain", NewSecret("signing"), NewSecret("bot"))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="client_secret"):
        DingTalkIMCandidate("client", "retain")  # type: ignore[arg-type]


def test_operation_result_requires_exactly_one_outcome() -> None:
    ref = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
    scope = ChannelScope(ChannelScopeKind.WORKSPACE, "workspace-1")
    view = ChannelView(
        ref=ref,
        scope=scope,
        configured=False,
        status=ChannelStatus.NOT_CONFIGURED,
        capabilities=frozenset((ChannelCapability.CONFIGURE,)),
        summary=ResendChannelSummary(None, None, False),
    )
    test_result = ChannelTestResult(
        ref=ref,
        scope=scope,
        status=ChannelStatus.CONNECTED,
        summary=ResendChannelTestSummary(
            NormalizedEmail("operator@example.com"),
            NormalizedEmail("sender@example.com"),
            "Sender",
        ),
        checked_at=UtcTimestamp.now(),
    )

    with pytest.raises(ValueError, match="exactly one"):
        ChannelOperationResult()
    with pytest.raises(ValueError, match="exactly one"):
        ChannelOperationResult(view=view, test_result=test_result)


def test_channel_view_rejects_candidate_state_mixed_with_persisted_state() -> None:
    ref = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
    scope = ChannelScope(ChannelScopeKind.WORKSPACE, "workspace-1")

    with pytest.raises(ValueError, match="credential state"):
        ChannelView(
            ref=ref,
            scope=scope,
            configured=False,
            status=ChannelStatus.NOT_CONFIGURED,
            capabilities=frozenset(),
            summary=ResendChannelSummary(
                NormalizedEmail("candidate@example.com"),
                "Candidate",
                True,
            ),
        )

    with pytest.raises(ValueError, match="complete integration"):
        ChannelView(
            ref=ChannelRef(ChannelKind.IM, ChannelProvider.SLACK),
            scope=scope,
            configured=True,
            status=ChannelStatus.CONFIGURED,
            capabilities=frozenset(),
            summary=IMChannelSummary("tested-tenant", IntegrationId("persisted-id"), None),
        )


def test_candidate_test_result_rejects_persisted_view_semantics() -> None:
    with pytest.raises(ValueError, match="not_configured"):
        ChannelTestResult(
            ref=ChannelRef(ChannelKind.IM, ChannelProvider.SLACK),
            scope=ChannelScope(ChannelScopeKind.WORKSPACE, "workspace-1"),
            status=ChannelStatus.NOT_CONFIGURED,
            summary=IMChannelTestSummary("tested-tenant"),
            checked_at=UtcTimestamp.now(),
        )


def test_common_core_has_no_forbidden_infrastructure_imports() -> None:
    root = Path(__file__).parents[5] / "core" / "human_input_v2"
    forbidden = ("controllers", "sqlalchemy", "models", "resend", "services")
    for package in ("channel_management", "email_channel"):
        for path in (root / package).glob("*.py"):
            tree = ast.parse(path.read_text())
            imported = [alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names]
            imported.extend(node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom))
            assert not any(name.startswith(forbidden) for name in imported), path
