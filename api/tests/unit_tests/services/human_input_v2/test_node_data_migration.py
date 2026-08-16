import inspect
from collections.abc import Sequence
from dataclasses import FrozenInstanceError
from typing import Never, override
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from controllers.common import human_input_v2_migration as migration_boundary
from core.human_input_v2.shared.values import NormalizedEmail, TenantId
from core.workflow.nodes.human_input_v2 import migration as migration_module
from core.workflow.nodes.human_input_v2.migration import (
    LegacyDeliveryParseIssue,
    LegacyHumanInputNodeData,
    MemberEmailSnapshot,
    MigrationBlockerCode,
    NodeMigrationConversion,
    ResolvedMemberEmail,
    convert_legacy_human_input_node_data,
)
from models.account import Account, AccountStatus, TenantAccountJoin
from services.human_input_v2 import node_data_migration as service_module
from services.human_input_v2.composition import build_human_input_node_data_migration_service
from services.human_input_v2.node_data_migration import (
    HumanInputNodeDataMigrationService,
    MigrationNode,
    NodeDataMigrationFailure,
    NodeDataMigrationSuccess,
)
from services.human_input_v2.workspace_member_email_lookup import SQLAlchemyWorkspaceMemberEmailLookup

_EMAIL_METHOD_ID = "11111111-1111-4111-8111-111111111111"
_WEBAPP_METHOD_ID = "22222222-2222-4222-8222-222222222222"


def _member_node(title: str, *member_ids: str) -> LegacyHumanInputNodeData:
    return LegacyHumanInputNodeData.model_validate(
        {
            "title": title,
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {"items": [{"type": "member", "user_id": member_id} for member_id in member_ids]},
                        "subject": "Review",
                        "body": "Please review",
                    },
                }
            ],
        }
    )


class _LookupSpy:
    def __init__(self, unavailable_account_ids: frozenset[str] = frozenset()) -> None:
        self.calls: list[tuple[TenantId, tuple[str, ...]]] = []
        self._unavailable_account_ids = unavailable_account_ids

    def find_member_emails(self, tenant_id: TenantId, account_ids: Sequence[str]) -> MemberEmailSnapshot:
        self.calls.append((tenant_id, tuple(account_ids)))
        return MemberEmailSnapshot(
            tuple(
                ResolvedMemberEmail(account_id, NormalizedEmail(f"{account_id}@example.com"))
                for account_id in account_ids
                if account_id not in self._unavailable_account_ids
            )
        )


class _ReadOnlyBoundarySpy(_LookupSpy):
    def __init__(self) -> None:
        super().__init__()
        self.write_attempts: list[str] = []

    def __getattr__(self, attribute_name: str) -> Never:
        self.write_attempts.append(attribute_name)
        raise AssertionError(f"unexpected persistence access: {attribute_name}")


class _ConverterSpy:
    def __init__(self) -> None:
        self.snapshot_ids: list[int] = []

    def __call__(
        self,
        node_data: LegacyHumanInputNodeData,
        member_emails: MemberEmailSnapshot,
    ) -> NodeMigrationConversion:
        self.snapshot_ids.append(id(member_emails))
        with pytest.raises(FrozenInstanceError):
            member_emails.__setattr__("entries", ())
        return convert_legacy_human_input_node_data(node_data, member_emails)


def test_batch_uses_one_ordered_member_lookup_and_one_immutable_snapshot() -> None:
    lookup = _LookupSpy()
    converter = _ConverterSpy()
    service = HumanInputNodeDataMigrationService(member_email_lookup=lookup, converter=converter)
    nodes = (
        MigrationNode("node-1", _member_node("First", "member-2", "member-1")),
        MigrationNode("node-2", _member_node("Second", "member-1", "member-3")),
    )

    outcome = service.migrate(tenant_id=TenantId("workspace-1"), nodes=nodes)

    assert lookup.calls == [("workspace-1", ("member-2", "member-1", "member-3"))]
    assert len(set(converter.snapshot_ids)) == 1
    assert isinstance(outcome, NodeDataMigrationSuccess)
    assert [result.node_id for result in outcome.data] == ["node-1", "node-2"]


def test_service_collects_real_frontend_user_id_member_references() -> None:
    lookup = _LookupSpy()
    service = HumanInputNodeDataMigrationService(member_email_lookup=lookup)
    node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {"items": [{"type": "member", "user_id": "member-1"}]},
                    },
                }
            ],
        }
    )

    outcome = service.migrate(
        tenant_id=TenantId("workspace-1"),
        nodes=(MigrationNode("node-1", node_data),),
    )

    assert lookup.calls == [("workspace-1", ("member-1",))]
    assert isinstance(outcome, NodeDataMigrationSuccess)
    assert outcome.data[0].node_data.recipients_spec[0].model_dump(mode="json") == {
        "type": "onetime_email",
        "email": "member-1@example.com",
    }


def test_service_merges_typed_preflight_issues_and_discards_converted_data() -> None:
    lookup = _LookupSpy()
    service = HumanInputNodeDataMigrationService(member_email_lookup=lookup)
    node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": "22222222-2222-4222-8222-222222222222",
                    "type": "webapp",
                    "config": {},
                }
            ],
        }
    )
    issue = LegacyDeliveryParseIssue(
        code=MigrationBlockerCode.UNSUPPORTED_DELIVERY_METHOD,
        method_position=0,
        method_id="33333333-3333-4333-8333-333333333333",
        value="im",
    )

    outcome = service.migrate(
        tenant_id=TenantId("workspace-1"),
        nodes=(
            MigrationNode(
                "node-1",
                node_data,
                method_positions=(1,),
                preflight_issues=(issue,),
            ),
        ),
    )

    assert isinstance(outcome, NodeDataMigrationFailure)
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in outcome.blockers] == [
        ("unsupported-delivery-method", "33333333-3333-4333-8333-333333333333", "im")
    ]
    assert not hasattr(outcome, "data")


def test_service_preserves_method_order_when_merging_preflight_and_conversion_blockers() -> None:
    service = HumanInputNodeDataMigrationService(member_email_lookup=_LookupSpy())
    node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": "11111111-1111-4111-8111-111111111111",
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {"items": [{"type": "external", "email": "invalid-email"}]},
                    },
                }
            ],
        }
    )
    issue = LegacyDeliveryParseIssue(
        code=MigrationBlockerCode.UNSUPPORTED_DELIVERY_METHOD,
        method_position=1,
        method_id="33333333-3333-4333-8333-333333333333",
        value="im",
    )

    outcome = service.migrate(
        tenant_id=TenantId("workspace-1"),
        nodes=(
            MigrationNode(
                "node-1",
                node_data,
                method_positions=(0,),
                preflight_issues=(issue,),
            ),
        ),
    )

    assert isinstance(outcome, NodeDataMigrationFailure)
    assert [(blocker.code, blocker.method_id) for blocker in outcome.blockers] == [
        ("invalid-email", "11111111-1111-4111-8111-111111111111"),
        ("unsupported-delivery-method", "33333333-3333-4333-8333-333333333333"),
        ("missing-recipients", None),
    ]


def test_service_preserves_recipient_source_order_across_preflight_and_converter_blockers() -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {
                            "items": [
                                {"type": "external", "email": "invalid-email"},
                                {"type": "external", "email": 7},
                                {"type": "member"},
                                {"type": "external", "email": "approver@example.com"},
                            ]
                        },
                    },
                }
            ],
        }
    )
    service = HumanInputNodeDataMigrationService(member_email_lookup=_LookupSpy())

    outcome = service.migrate(
        tenant_id=TenantId("workspace-1"),
        nodes=(
            MigrationNode.from_preflight(
                "node-1", migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)
            ),
        ),
    )

    assert isinstance(outcome, NodeDataMigrationFailure)
    assert [(blocker.code, blocker.value) for blocker in outcome.blockers] == [
        ("invalid-email", "invalid-email"),
        ("invalid-email", None),
        ("unresolved-member", None),
    ]


def test_service_preserves_adversarial_preflight_and_conversion_order_without_partial_data() -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "default_value": [{"key": "fallback", "type": "object", "value": False}],
            "delivery_methods": [
                {"id": None, "type": "webapp", "config": {}},
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {"items": [{"type": "external", "email": "invalid-email"}]},
                    },
                },
                {"id": _EMAIL_METHOD_ID, "type": "email", "enabled": False, "config": None},
                {"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}},
            ],
        }
    )
    service = HumanInputNodeDataMigrationService(member_email_lookup=_LookupSpy())

    outcome = service.migrate(
        tenant_id=TenantId("workspace-1"),
        nodes=(
            MigrationNode.from_preflight(
                "node-1", migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)
            ),
        ),
    )

    assert isinstance(outcome, NodeDataMigrationFailure)
    assert not hasattr(outcome, "data")
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in outcome.blockers] == [
        ("invalid-default-value", None, "default_value"),
        ("unsupported-delivery-method", None, "webapp"),
        ("invalid-email", _EMAIL_METHOD_ID, "invalid-email"),
        ("configured-disabled-method", _EMAIL_METHOD_ID, "email"),
    ]


def test_service_orders_invalid_delivery_ids_without_partial_data_or_persistence_writes() -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {"type": "webapp", "config": {}},
                {"id": None, "type": "webapp", "config": {}},
                {"id": "invalid-id", "type": "webapp", "config": {}},
                {"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}},
            ],
        }
    )
    lookup = _ReadOnlyBoundarySpy()
    service = HumanInputNodeDataMigrationService(member_email_lookup=lookup)

    outcome = service.migrate(
        tenant_id=TenantId("workspace-1"),
        nodes=(
            MigrationNode.from_preflight(
                "node-1", migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)
            ),
        ),
    )

    assert lookup.calls == [("workspace-1", ())]
    assert lookup.write_attempts == []
    assert isinstance(outcome, NodeDataMigrationFailure)
    assert not hasattr(outcome, "data")
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in outcome.blockers] == [
        ("unsupported-delivery-method", None, "webapp"),
        ("unsupported-delivery-method", None, "webapp"),
        ("unsupported-delivery-method", "invalid-id", "webapp"),
    ]


def test_service_source_orders_disabled_unknown_methods_as_unsupported_without_partial_data() -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {"id": "unknown-1", "type": "future-one", "enabled": False},
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {"items": [{"type": "external", "email": "invalid-email"}]},
                    },
                },
                {"id": "unknown-2", "type": "future-two", "enabled": False, "config": {}},
                {"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}},
            ],
        }
    )
    service = HumanInputNodeDataMigrationService(member_email_lookup=_LookupSpy())

    outcome = service.migrate(
        tenant_id=TenantId("workspace-1"),
        nodes=(
            MigrationNode.from_preflight(
                "node-1", migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)
            ),
        ),
    )

    assert isinstance(outcome, NodeDataMigrationFailure)
    assert not hasattr(outcome, "data")
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in outcome.blockers] == [
        ("unsupported-delivery-method", "unknown-1", "future-one"),
        ("invalid-email", _EMAIL_METHOD_ID, "invalid-email"),
        ("unsupported-delivery-method", "unknown-2", "future-two"),
    ]


def test_service_orders_duplicate_method_ids_by_canonical_index_not_id() -> None:
    duplicate_method_id = "11111111-1111-4111-8111-111111111111"
    node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": duplicate_method_id,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {"items": [{"type": "external", "email": "first-invalid"}]},
                    },
                },
                {
                    "id": duplicate_method_id,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {"items": [{"type": "external", "email": "second-invalid"}]},
                    },
                },
            ],
        }
    )
    issue = LegacyDeliveryParseIssue(
        code=MigrationBlockerCode.UNSUPPORTED_DELIVERY_METHOD,
        method_position=1,
        method_id="unsupported-between-duplicates",
        value="im",
    )
    service = HumanInputNodeDataMigrationService(member_email_lookup=_LookupSpy())

    outcome = service.migrate(
        tenant_id=TenantId("workspace-1"),
        nodes=(
            MigrationNode(
                "node-1",
                node_data,
                method_positions=(0, 2),
                preflight_issues=(issue,),
            ),
        ),
    )

    assert isinstance(outcome, NodeDataMigrationFailure)
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in outcome.blockers] == [
        ("invalid-email", duplicate_method_id, "first-invalid"),
        ("unsupported-delivery-method", "unsupported-between-duplicates", "im"),
        ("invalid-email", duplicate_method_id, "second-invalid"),
        ("missing-recipients", None, None),
    ]


def test_service_aggregates_real_im_and_disabled_unknown_method_blockers() -> None:
    lookup = _LookupSpy()
    service = HumanInputNodeDataMigrationService(member_email_lookup=lookup)
    node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [],
        }
    )
    issues = (
        LegacyDeliveryParseIssue(
            code=MigrationBlockerCode.UNSUPPORTED_DELIVERY_METHOD,
            method_position=0,
            method_id="im-1",
            value="im",
        ),
        LegacyDeliveryParseIssue(
            code=MigrationBlockerCode.CONFIGURED_DISABLED_METHOD,
            method_position=1,
            method_id="future-1",
            value="future-channel",
        ),
    )

    outcome = service.migrate(
        tenant_id=TenantId("workspace-1"),
        nodes=(MigrationNode("node-1", node_data, preflight_issues=issues),),
    )

    assert isinstance(outcome, NodeDataMigrationFailure)
    assert [(blocker.node_id, blocker.code, blocker.method_id, blocker.value) for blocker in outcome.blockers] == [
        ("node-1", "unsupported-delivery-method", "im-1", "im"),
        ("node-1", "configured-disabled-method", "future-1", "future-channel"),
        ("node-1", "missing-recipients", None, None),
    ]


def test_batch_aggregates_blockers_discards_valid_results_and_retries_equivalently() -> None:
    lookup = _LookupSpy(frozenset({"missing-member"}))
    service = HumanInputNodeDataMigrationService(member_email_lookup=lookup)
    valid_node = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Valid",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
        }
    )
    invalid_node = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Invalid",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {
                            "items": [
                                {"type": "external", "email": "invalid-email"},
                                {"type": "member", "user_id": "missing-member"},
                            ]
                        },
                    },
                }
            ],
        }
    )
    nodes = (MigrationNode("node-valid", valid_node), MigrationNode("node-invalid", invalid_node))

    first = service.migrate(tenant_id=TenantId("workspace-1"), nodes=nodes)
    second = service.migrate(tenant_id=TenantId("workspace-1"), nodes=nodes)

    assert first == second
    assert isinstance(first, NodeDataMigrationFailure)
    assert not hasattr(first, "data")
    assert [(blocker.node_id, blocker.node_title, blocker.code) for blocker in first.blockers] == [
        ("node-invalid", "Invalid", "invalid-email"),
        ("node-invalid", "Invalid", "unresolved-member"),
        ("node-invalid", "Invalid", "missing-recipients"),
    ]
    assert lookup.calls == [
        ("workspace-1", ("missing-member",)),
        ("workspace-1", ("missing-member",)),
    ]


def test_success_blocked_and_repeated_requests_have_no_persistence_write_boundary() -> None:
    service_source = inspect.getsource(service_module)
    for forbidden_dependency in (
        "extensions.ext_database",
        "models.",
        "repositories.",
        "db.session",
        ".commit(",
        ".flush(",
    ):
        assert forbidden_dependency not in service_source

    lookup = _ReadOnlyBoundarySpy()
    service = HumanInputNodeDataMigrationService(member_email_lookup=lookup)
    successful_nodes = (
        MigrationNode(
            "node-success",
            LegacyHumanInputNodeData.model_validate(
                {
                    "title": "Success",
                    "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
                }
            ),
        ),
    )
    blocked_nodes = (
        MigrationNode(
            "node-blocked",
            LegacyHumanInputNodeData.model_validate({"title": "Blocked", "delivery_methods": []}),
        ),
    )

    success = service.migrate(tenant_id=TenantId("workspace-1"), nodes=successful_nodes)
    blocked = service.migrate(tenant_id=TenantId("workspace-1"), nodes=blocked_nodes)
    repeated_first = service.migrate(tenant_id=TenantId("workspace-1"), nodes=successful_nodes)
    repeated_second = service.migrate(tenant_id=TenantId("workspace-1"), nodes=successful_nodes)

    assert isinstance(success, NodeDataMigrationSuccess)
    assert isinstance(blocked, NodeDataMigrationFailure)
    assert repeated_first == repeated_second == success
    assert lookup.write_attempts == []


def test_whole_workspace_does_not_enumerate_members() -> None:
    lookup = _LookupSpy()
    service = HumanInputNodeDataMigrationService(member_email_lookup=lookup)
    node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {"whole_workspace": True},
                    },
                }
            ],
        }
    )

    outcome = service.migrate(
        tenant_id=TenantId("workspace-1"),
        nodes=(MigrationNode("node-1", node_data),),
    )

    assert isinstance(outcome, NodeDataMigrationSuccess)
    assert lookup.calls == [("workspace-1", ())]


class _TrackingReadSession(Session):
    close_count = 0
    commit_count = 0
    flush_count = 0

    @override
    def close(self) -> None:
        _TrackingReadSession.close_count += 1
        super().close()

    @override
    def commit(self) -> None:
        _TrackingReadSession.commit_count += 1
        super().commit()

    @override
    def flush(self, objects: Sequence[object] | None = None) -> None:
        _TrackingReadSession.flush_count += 1
        super().flush(objects)


def test_sql_lookup_is_tenant_scoped_active_read_only_and_closes_session(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id = TenantId(str(uuid4()))
    other_tenant_id = TenantId(str(uuid4()))
    with sqlite_session_factory.begin() as arrange_session:
        active = Account(name="Active", email="  ACTIVE@Example.COM ")
        banned = Account(name="Banned", email="banned@example.com", status=AccountStatus.BANNED)
        invalid_email = Account(name="Invalid", email="invalid-email")
        cross_workspace = Account(name="Cross", email="cross@example.com")
        arrange_session.add_all([active, banned, invalid_email, cross_workspace])
        arrange_session.flush()
        arrange_session.add_all(
            [
                TenantAccountJoin(tenant_id=tenant_id, account_id=active.id),
                TenantAccountJoin(tenant_id=tenant_id, account_id=banned.id),
                TenantAccountJoin(tenant_id=tenant_id, account_id=invalid_email.id),
                TenantAccountJoin(tenant_id=other_tenant_id, account_id=cross_workspace.id),
            ]
        )

    _TrackingReadSession.close_count = 0
    _TrackingReadSession.commit_count = 0
    _TrackingReadSession.flush_count = 0
    engine = sqlite_session_factory.kw["bind"]
    assert isinstance(engine, Engine)
    read_factory = sessionmaker(bind=engine, class_=_TrackingReadSession, expire_on_commit=False)
    select_count = 0

    def count_selects(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        nonlocal select_count
        if statement.lstrip().upper().startswith("SELECT"):
            select_count += 1

    event.listen(engine, "before_cursor_execute", count_selects)
    try:
        lookup = SQLAlchemyWorkspaceMemberEmailLookup(read_factory)
        member_emails = lookup.find_member_emails(
            tenant_id,
            (active.id, banned.id, invalid_email.id, cross_workspace.id, str(uuid4())),
        )
    finally:
        event.remove(engine, "before_cursor_execute", count_selects)

    assert isinstance(member_emails, migration_module.MemberEmailSnapshot)
    assert [(entry.member_id, str(entry.email)) for entry in member_emails.entries] == [
        (active.id, "active@example.com")
    ]
    assert select_count == 1
    assert _TrackingReadSession.close_count == 1
    assert _TrackingReadSession.commit_count == 0
    assert _TrackingReadSession.flush_count == 0


def test_composition_injects_sql_lookup_and_core_converter_has_no_infrastructure_imports() -> None:
    service = build_human_input_node_data_migration_service()

    assert isinstance(service, HumanInputNodeDataMigrationService)
    assert isinstance(service._member_email_lookup, SQLAlchemyWorkspaceMemberEmailLookup)

    converter_source = inspect.getsource(migration_module)
    for forbidden_import in ("flask", "sqlalchemy", "models", "repositories", "recipient_resolution"):
        assert forbidden_import not in converter_source
