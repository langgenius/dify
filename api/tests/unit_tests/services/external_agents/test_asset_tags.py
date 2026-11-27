"""Shared Agent labels over real SQL, preserving External lifecycle and revisions."""

from dataclasses import asdict
from datetime import UTC, datetime

import pytest
from sqlalchemy import event, select

from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus
from models.external_agent import ExternalAgentHead
from models.external_agent_trace import ExternalAgentDataTombstone
from models.model import Tag, TagBinding
from repositories.tag_repository import TagRepository
from services.external_agents.contracts import AssetPage
from services.tag_application_service import (
    CreateTagInput,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagKind,
    UpdateTagInput,
)
from tests.unit_tests.repositories.external_agents.test_runtime_repository import bound_engine, stored, uid
from tests.unit_tests.services.external_agents import test_control_plane_applications as fixtures
from tests.unit_tests.services.external_agents.test_control_plane_applications import ControlPlane

domain = fixtures.domain
control = fixtures.control


def label(control: ControlPlane, name: str, *, kind: TagKind = TagKind.AGENT) -> str:
    return (
        TagRepository(control.database[1])
        .create_tag(control.context.active_workspace_id, control.context.account_id, CreateTagInput(name, kind))
        .id
    )


def bind(control: ControlPlane, target: str, *tag_ids: str) -> None:
    TagRepository(control.database[1]).create_bindings(
        control.context.active_workspace_id, control.context.account_id, TagBindingInput(tag_ids, target, TagKind.AGENT)
    )


def page(
    control: ControlPlane, *tag_ids: str, enabled: bool | None = None, limit: int = 100, number: int = 1
) -> AssetPage:
    return control.assets.list(
        control.context,
        page=number,
        limit=limit,
        keyword=None,
        enabled=enabled,
        connected_by_me=False,
        tag_ids=tag_ids,
    )


def test_native_and_disabled_external_share_one_pool_without_mutating_asset_state(control: ControlPlane) -> None:
    """Shared labels and counts follow Agent IDs; they never update External revisions."""
    external, native = control.database[3], uid()
    with control.database[1].begin() as session:
        session.add(
            Agent(
                id=native,
                tenant_id=control.context.active_workspace_id,
                name="Native tagged",
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.ROSTER,
            )
        )
    control.assets.set_enabled(control.context, external, False)
    before = asdict(control.store.get_asset(tenant_id=control.context.active_workspace_id, agent_id=external))
    tag_id = label(control, "Shared")
    bind(control, native, tag_id)
    bind(control, external, tag_id, tag_id)
    bind(control, external, tag_id)
    repository = TagRepository(control.database[1])
    assert repository.list_tags(control.context.active_workspace_id, "agent", None)[0].binding_count == 2
    assert asdict(control.store.get_asset(tenant_id=control.context.active_workspace_id, agent_id=external)) == before
    listed = page(control, tag_id, enabled=False)
    assert listed.total == listed.disabled_count == 1
    assert listed.enabled_count == 0
    assert [asdict(tag) for tag in listed.items[0].tags] == [{"id": tag_id, "name": "Shared", "type": "agent"}]
    repository.update_tag(control.context.active_workspace_id, tag_id, UpdateTagInput("Renamed"))
    assert control.assets.detail(control.context, external)["asset"]["tags"][0]["name"] == "Renamed"
    repository.delete_bindings(control.context.active_workspace_id, TagBindingInput((tag_id,), external, TagKind.AGENT))
    assert repository.list_tags(control.context.active_workspace_id, "agent", None)[0].binding_count == 1
    assert page(control, tag_id).items == ()
    repository.delete_tag(control.context.active_workspace_id, tag_id)
    with control.database[1]() as session:
        assert session.scalar(select(TagBinding.id).where(TagBinding.tag_id == tag_id)) is None


def test_all_tag_filters_precede_status_counts_visibility_and_pagination(control: ControlPlane) -> None:
    first, second, third = (
        control.database[3],
        control.create(metadata={"name": "Tagged disabled"}).resource_id,
        control.create(metadata={"name": "Only one"}).resource_id,
    )
    a, b, studio = label(control, "A"), label(control, "B"), label(control, "Studio", kind=TagKind.APP)
    bind(control, first, a, b)
    bind(control, second, a, b)
    bind(control, third, a)
    control.assets.set_enabled(control.context, second, False)
    selected = page(control, a, b, a, limit=1)
    assert selected.total == 2
    assert len(selected.items) == 1
    assert selected.enabled_count == selected.disabled_count == 1
    assert page(control, a, b, enabled=False).items[0].id == second
    assert page(control, a, b, number=2, limit=1).items[0].id != selected.items[0].id
    assert page(control, a, uid()).total == 0
    assert page(control, studio).total == 0
    control.access.visibility = frozenset({first, third})
    visible = page(control, a, b)
    assert visible.total == visible.enabled_count == 1
    assert visible.disabled_count == 0


@pytest.mark.parametrize(
    "state",
    [
        "head_deleted",
        "head_missing",
        "head_foreign",
        "head_unsaved",
        "agent_foreign",
        "archived",
        "workflow_only",
        "retired_tenant",
    ],
)
def test_external_binding_rejects_unavailable_targets_without_writes(control: ControlPlane, state: str) -> None:
    external, tag_id = control.database[3], label(control, "Admission")
    with control.database[1].begin() as session:
        agent = stored(session, Agent, external)
        head = stored(session, ExternalAgentHead, external)
        if state == "head_deleted":
            head.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        elif state == "head_missing":
            session.delete(head)
        elif state == "head_foreign":
            head.tenant_id = uid()
        elif state == "head_unsaved":
            head.active_connection_revision_id = None
        elif state == "agent_foreign":
            agent.tenant_id = uid()
        elif state == "archived":
            agent.status = AgentStatus.ARCHIVED
        elif state == "workflow_only":
            agent.scope = AgentScope.WORKFLOW_ONLY
        elif state == "retired_tenant":
            session.add(
                ExternalAgentDataTombstone(
                    id=uid(),
                    tenant_id=control.context.active_workspace_id,
                    owner_kind="tenant",
                    owner_id=control.context.active_workspace_id,
                    deleted_at=datetime.now(UTC).replace(tzinfo=None),
                )
            )
    with pytest.raises(TagBindingTargetNotFoundError):
        bind(control, external, tag_id)
    with pytest.raises(TagBindingTargetNotFoundError):
        TagRepository(control.database[1]).delete_bindings(
            control.context.active_workspace_id, TagBindingInput((tag_id,), external, TagKind.AGENT)
        )
    with control.database[1]() as session:
        assert session.scalar(select(TagBinding.id)) is None


def test_external_archive_removes_only_its_shared_agent_bindings(control: ControlPlane) -> None:
    first, other = control.database[3], control.create(metadata={"name": "Kept external"}).resource_id
    tag_id = label(control, "Keep pool")
    bind(control, first, tag_id)
    bind(control, other, tag_id)
    control.assets.delete(control.context, first)
    control.assets.delete(control.context, first)
    with control.database[1]() as session:
        assert session.scalar(select(Tag.id).where(Tag.id == tag_id)) == tag_id
        assert list(session.scalars(select(TagBinding.target_id).where(TagBinding.tag_id == tag_id))) == [other]
    with pytest.raises(TagBindingTargetNotFoundError):
        bind(control, first, tag_id)


def test_asset_mutation_responses_keep_current_tags_and_acl_projection(control: ControlPlane) -> None:
    """Shared asset response DTOs never replace a real tag set with a fabricated empty value."""
    external = control.create(metadata={"name": "Tagged presentation"}).resource_id
    tag_id = label(control, "Persist in response")
    bind(control, external, tag_id)
    current = control.assets.detail(control.context, external)["asset"]
    changed = control.assets.update_info(
        control.context,
        agent_id=external,
        expected_revision=current["metadata_revision"],
        changes={"description": "New info"},
    )
    disabled = control.assets.set_enabled(control.context, external, False)
    traced = control.assets.set_tracing(control.context, external, True)
    for result in (changed, disabled, traced):
        assert [tag.id for tag in result.tags] == [tag_id]
        assert "agent.acl.edit" in result.permission_keys


def test_external_tag_projection_uses_one_query_for_one_or_many_visible_assets(control: ControlPlane) -> None:
    identifiers = (
        control.database[3],
        *(control.create(metadata={"name": f"Batch {n}"}).resource_id for n in range(3)),
    )
    tag_id = label(control, "Batch tag")
    for identifier in identifiers:
        bind(control, identifier, tag_id)
    statements: list[str] = []

    def capture(
        _conn: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        statements.append(statement)

    engine = bound_engine(control.database[1])
    event.listen(engine, "before_cursor_execute", capture)
    try:
        control.access.visibility = frozenset(identifiers[:1])
        assert len(page(control).items) == 1
        one = len(statements)
        statements.clear()
        control.access.visibility = frozenset(identifiers)
        assert len(page(control).items) == 4
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert len(statements) == one
    assert len([sql for sql in statements if "JOIN tags" in sql]) == 1
