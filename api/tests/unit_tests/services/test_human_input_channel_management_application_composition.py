from __future__ import annotations

import ast
from pathlib import Path

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.channel_management import (
    ChannelFailureCategory,
    ChannelHandlerRegistry,
    ChannelKind,
    ChannelProvider,
    ChannelRef,
    DeleteChannelCommand,
    DingTalkIMCandidate,
    FeishuIMCandidate,
    NewSecret,
    SaveIMChannelCommand,
    SlackIMCandidate,
)
from core.human_input_v2.channel_management import TestEmailChannelCommand as EmailTestChannelCommand
from core.human_input_v2.channel_management import TestIMChannelCommand as IMTestChannelCommand
from core.human_input_v2.email_channel import NewAPIKey, ResendCandidate
from core.human_input_v2.shared import NormalizedEmail
from services.human_input_channel_management_composition import (
    UnimplementedIMChannelHandler,
    build_human_input_channel_management_context,
    build_human_input_channel_management_service,
)
from services.human_input_email_channel_manager import HumanInputEmailChannelManager
from services.human_input_im_channel_manager import HumanInputIMChannelManager
from services.human_input_resend_channel import ResendEmailProviderValidator


def test_composition_registers_resend_slack_and_two_explicit_im_stubs(sqlite_engine) -> None:
    service = build_human_input_channel_management_service(
        session_maker=sessionmaker(sqlite_engine, class_=Session),
    )

    assert {handler.ref for handler in service._registry.handlers()} == {
        ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND),
        ChannelRef(ChannelKind.IM, ChannelProvider.SLACK),
        ChannelRef(ChannelKind.IM, ChannelProvider.FEISHU),
        ChannelRef(ChannelKind.IM, ChannelProvider.DING_TALK),
    }
    email_handler = next(handler for handler in service._registry.handlers() if handler.ref.kind is ChannelKind.EMAIL)
    assert isinstance(email_handler, HumanInputEmailChannelManager)
    assert isinstance(email_handler._validator, ResendEmailProviderValidator)
    im_handlers = [handler for handler in service._registry.handlers() if handler.ref.kind is ChannelKind.IM]
    slack_handler = next(handler for handler in im_handlers if handler.ref.provider is ChannelProvider.SLACK)
    assert isinstance(slack_handler, HumanInputIMChannelManager)
    context = build_human_input_channel_management_context(
        workspace_id="workspace-1",
        actor_account_id="account-1",
        actor_email="operator@example.com",
    )
    unimplemented_handlers = [handler for handler in im_handlers if handler.ref.provider is not ChannelProvider.SLACK]
    for handler in unimplemented_handlers:
        assert isinstance(handler, UnimplementedIMChannelHandler)
        failure = handler.get(context).failure
        assert failure is not None
        assert failure.category is ChannelFailureCategory.UNSUPPORTED_OPERATION

    with pytest.raises(ValueError):
        ChannelHandlerRegistry((im_handlers[0], im_handlers[0]))


@pytest.mark.parametrize(
    ("ref", "candidate"),
    [
        (
            ChannelRef(ChannelKind.IM, ChannelProvider.SLACK),
            SlackIMCandidate(
                "client",
                NewSecret("secret"),
                NewSecret("signing"),
                NewSecret("xoxb-test-bot"),
                NewSecret("xapp-test-app"),
            ),
        ),
        (
            ChannelRef(ChannelKind.IM, ChannelProvider.FEISHU),
            FeishuIMCandidate("app", NewSecret("secret")),
        ),
        (
            ChannelRef(ChannelKind.IM, ChannelProvider.DING_TALK),
            DingTalkIMCandidate("corp", "client", NewSecret("secret")),
        ),
    ],
)
def test_im_placeholders_reject_every_operation_without_infrastructure(ref, candidate) -> None:
    context = build_human_input_channel_management_context(
        workspace_id="workspace-1",
        actor_account_id="account-1",
        actor_email="operator@example.com",
    )
    handler = UnimplementedIMChannelHandler(ref)

    results = (
        handler.get(context),
        handler.test(context, IMTestChannelCommand(ref, candidate)),
        handler.save(context, SaveIMChannelCommand(ref, candidate)),
        handler.delete(context, DeleteChannelCommand(ref)),
    )

    for result in results:
        assert result.failure is not None
        assert result.failure.category is ChannelFailureCategory.UNSUPPORTED_OPERATION
        assert result.failure.code == "im_channel_management_not_implemented"


def test_resend_test_dispatches_through_injected_provider_adapter(sqlite_engine) -> None:
    class Validator:
        def __init__(self) -> None:
            self.calls: list[tuple[str, str | None]] = []

        def validate(self, _settings) -> None:
            self.calls.append(("validate", None))

        def send_test(self, _settings, recipient) -> None:
            self.calls.append(("send_test", str(recipient)))

    validator = Validator()
    service = build_human_input_channel_management_service(
        session_maker=sessionmaker(sqlite_engine, class_=Session),
        email_validator=validator,
    )
    context = build_human_input_channel_management_context(
        workspace_id="workspace-1",
        actor_account_id="account-1",
        actor_email="operator@example.com",
    )
    ref = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
    candidate = ResendCandidate(
        NormalizedEmail("sender@example.com"),
        "Sender",
        NewAPIKey("request-key"),
    )
    result = service.test_channel(context, EmailTestChannelCommand(ref, candidate))

    assert result.test_result is not None
    assert result.test_result.summary.recipient_email == context.actor_email
    assert validator.calls == [
        ("validate", None),
        ("send_test", "operator@example.com"),
    ]


def test_collection_has_bounded_queries_and_performs_no_provider_io(sqlite_engine) -> None:
    service = build_human_input_channel_management_service(
        session_maker=sessionmaker(sqlite_engine, class_=Session),
    )
    context = build_human_input_channel_management_context(
        workspace_id="workspace-1",
        actor_account_id="account-1",
        actor_email="operator@example.com",
    )
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        result = service.list_channels(context)
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert len(result.channels) == 2
    assert len(result.failures) == 2
    assert len([statement for statement in statements if statement.lstrip().upper().startswith("SELECT")]) == 2


def test_channel_layers_keep_transport_persistence_and_provider_imports_separate() -> None:
    api_root = Path(__file__).resolve().parents[3]
    modules = {
        api_root / "controllers/common/human_input_channel_management.py": (
            "models.human_input_v2",
            "repositories.human_input_v2",
            "resend",
        ),
        api_root / "controllers/console/workspace/human_input.py": (
            "models.human_input_v2",
            "repositories.human_input_v2",
            "resend",
        ),
        api_root / "services/human_input_channel_management_composition.py": (
            "httpx",
            "resend",
        ),
    }

    for path, forbidden_prefixes in modules.items():
        tree = ast.parse(path.read_text())
        imported_modules = {
            node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module is not None
        }
        imported_modules.update(
            alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names
        )
        assert not any(
            imported_module == prefix or imported_module.startswith(f"{prefix}.")
            for imported_module in imported_modules
            for prefix in forbidden_prefixes
        )


def test_context_factory_builds_workspace_actor_facts_without_im_ownership_resolution() -> None:
    context = build_human_input_channel_management_context(
        workspace_id="workspace-1",
        actor_account_id="account-1",
        actor_email="Operator@Example.com",
    )

    assert str(context.tenant_id) == "workspace-1"
    assert str(context.actor_account_id) == "account-1"
    assert str(context.actor_email) == "operator@example.com"
    assert context.organization_id is None
    assert context.deployment_id is None
    assert context.use_deployment_im_scope is False
