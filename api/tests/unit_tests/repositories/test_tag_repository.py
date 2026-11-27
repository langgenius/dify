import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.enums import TagType
from models.model import Tag, TagBinding
from models.skill import Skill
from models.snippet import CustomizedSnippet, SnippetType
from repositories.tag_repository import TagRepository
from services.tag_application_service import (
    CreateTagInput,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagKind,
    TagNameConflictError,
    TagNotFoundError,
    UpdateTagInput,
)


def _tag(tag_id: str, *, workspace_id: str, tag_type: TagType, name: str) -> Tag:
    tag = Tag(tenant_id=workspace_id, type=tag_type, name=name, created_by="account-1")
    tag.id = tag_id
    return tag


def _snippet(snippet_id: str, *, workspace_id: str) -> CustomizedSnippet:
    snippet = CustomizedSnippet(
        tenant_id=workspace_id,
        name="Snippet",
        description="",
        type=SnippetType.NODE.value,
        created_by="account-1",
        updated_by="account-1",
    )
    snippet.id = snippet_id
    return snippet


def _skill(skill_id: str, *, workspace_id: str) -> Skill:
    skill = Skill(
        tenant_id=workspace_id,
        name=f"skill-{skill_id}",
        display_name="Skill",
        created_by="account-1",
        updated_by="account-1",
    )
    skill.id = skill_id
    return skill


def test_list_tags_scopes_binding_counts_and_escapes_keyword(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _tag("tag-1", workspace_id="workspace-1", tag_type=TagType.APP, name="50% discount"),
                _tag("tag-2", workspace_id="workspace-1", tag_type=TagType.APP, name="500 discount"),
                _tag("tag-3", workspace_id="workspace-2", tag_type=TagType.APP, name="50% other"),
                TagBinding(tenant_id="workspace-1", tag_id="tag-1", target_id="app-1", created_by="account-1"),
                TagBinding(tenant_id="workspace-2", tag_id="tag-1", target_id="app-2", created_by="account-2"),
            ]
        )

    result = TagRepository(sqlite_session_factory).list_tags("workspace-1", "app", "50%")

    assert result == (("tag-1", "50% discount", "app", 1),)


def test_tag_lifecycle_uses_owned_transactions_and_workspace_scope(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = TagRepository(sqlite_session_factory)
    created = repository.create_tag("workspace-1", "account-1", CreateTagInput("Original", TagKind.KNOWLEDGE))

    with sqlite_session_factory.begin() as session:
        session.add(
            TagBinding(
                tenant_id="workspace-1",
                tag_id=created.id,
                target_id="dataset-1",
                created_by="account-1",
            )
        )

    assert repository.get_tag_type("workspace-1", created.id) == "knowledge"
    assert repository.get_tag_type("workspace-2", created.id) is None

    updated = repository.update_tag("workspace-1", created.id, UpdateTagInput("Updated"))
    assert updated.name == "Updated"
    assert updated.binding_count == 1

    with pytest.raises(TagNameConflictError):
        repository.create_tag("workspace-1", "account-1", CreateTagInput("Updated", TagKind.KNOWLEDGE))

    with pytest.raises(TagNotFoundError):
        repository.update_tag("workspace-2", created.id, UpdateTagInput("Leaked"))

    repository.delete_tag("workspace-1", created.id)
    with sqlite_session_factory() as session:
        assert session.scalar(select(Tag.id).where(Tag.id == created.id)) is None
        assert session.scalar(select(TagBinding.id).where(TagBinding.tag_id == created.id)) is None


def test_binding_mutations_validate_target_type_and_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _snippet("snippet-1", workspace_id="workspace-1"),
                _tag("tag-1", workspace_id="workspace-1", tag_type=TagType.SNIPPET, name="Valid"),
                _tag("tag-2", workspace_id="workspace-1", tag_type=TagType.APP, name="Wrong type"),
                _tag("tag-3", workspace_id="workspace-2", tag_type=TagType.SNIPPET, name="Wrong workspace"),
            ]
        )

    repository = TagRepository(sqlite_session_factory)
    binding = TagBindingInput(("tag-1", "tag-1", "tag-2", "tag-3"), "snippet-1", TagKind.SNIPPET)
    repository.create_bindings("workspace-1", "account-1", binding)
    repository.create_bindings("workspace-1", "account-1", binding)

    with sqlite_session_factory() as session:
        bindings = session.scalars(select(TagBinding).where(TagBinding.target_id == "snippet-1")).all()
        assert len(bindings) == 1
        assert bindings[0].tag_id == "tag-1"
        assert bindings[0].tenant_id == "workspace-1"

    repository.delete_bindings("workspace-1", binding)
    with sqlite_session_factory() as session:
        assert session.scalars(select(TagBinding).where(TagBinding.target_id == "snippet-1")).all() == []


def test_binding_mutation_rejects_missing_target(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = TagRepository(sqlite_session_factory)

    with pytest.raises(TagBindingTargetNotFoundError, match="Snippet not found"):
        repository.create_bindings(
            "workspace-1",
            "account-1",
            TagBindingInput(("tag-1",), "missing", TagKind.SNIPPET),
        )


def test_binding_mutations_validate_skill_target(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _skill("skill-1", workspace_id="workspace-1"),
                _tag("tag-1", workspace_id="workspace-1", tag_type=TagType.SKILL, name="Skill"),
                _tag("tag-2", workspace_id="workspace-1", tag_type=TagType.APP, name="Wrong type"),
                _tag("tag-3", workspace_id="workspace-2", tag_type=TagType.SKILL, name="Wrong workspace"),
            ]
        )

    repository = TagRepository(sqlite_session_factory)
    binding = TagBindingInput(("tag-1", "tag-2", "tag-3"), "skill-1", TagKind.SKILL)
    repository.create_bindings("workspace-1", "account-1", binding)

    with sqlite_session_factory() as session:
        bindings = session.scalars(select(TagBinding).where(TagBinding.target_id == "skill-1")).all()
        assert len(bindings) == 1
        assert bindings[0].tag_id == "tag-1"
        assert bindings[0].tenant_id == "workspace-1"

    repository.delete_bindings("workspace-1", binding)
    with sqlite_session_factory() as session:
        assert session.scalars(select(TagBinding).where(TagBinding.target_id == "skill-1")).all() == []

    with pytest.raises(TagBindingTargetNotFoundError, match="Skill not found"):
        repository.create_bindings(
            "workspace-1",
            "account-1",
            TagBindingInput(("tag-1",), "missing", TagKind.SKILL),
        )


@pytest.mark.parametrize(
    ("tag_ids", "match_all", "expected"),
    [
        ([], False, set()),
        (["tag-1", "tag-1", "tag-2"], True, {"target-both"}),
        (["tag-1", "tag-2"], False, {"target-one", "target-both"}),
        (["tag-1", "missing"], True, set()),
        (["other-tenant"], False, set()),
        (["other-type"], False, set()),
    ],
)
def test_target_query_shares_scoped_matching_and_releases_its_session(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    tag_ids: list[str],
    match_all: bool,
    expected: set[str],
) -> None:
    from sqlalchemy.pool import QueuePool

    from services.tag_application_service import TagApplicationService

    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _tag("tag-1", workspace_id="workspace-1", tag_type=TagType.APP, name="First"),
                _tag("tag-2", workspace_id="workspace-1", tag_type=TagType.APP, name="Second"),
                _tag("other-tenant", workspace_id="workspace-2", tag_type=TagType.APP, name="Foreign"),
                _tag("other-type", workspace_id="workspace-1", tag_type=TagType.KNOWLEDGE, name="Knowledge"),
            ]
        )
        session.add_all(
            [
                TagBinding(tenant_id="workspace-1", tag_id="tag-1", target_id="target-one", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", tag_id="tag-1", target_id="target-both", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", tag_id="tag-2", target_id="target-both", created_by="account-1"),
                TagBinding(tenant_id="workspace-2", tag_id="tag-1", target_id="foreign", created_by="account-1"),
            ]
        )
    service = TagApplicationService(tags=TagRepository(sqlite_session_factory))
    result = service.find_target_ids(tenant_id="workspace-1", tag_type="app", tag_ids=tag_ids, match_all=match_all)
    assert set(result) == expected
    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0


def _agent(
    agent_id: str,
    *,
    workspace_id: str = "workspace-1",
    scope: AgentScope = AgentScope.ROSTER,
    status: AgentStatus = AgentStatus.ACTIVE,
) -> Agent:
    """Build a real Agent with explicit lifecycle facts for binding validation."""
    return Agent(
        id=agent_id,
        tenant_id=workspace_id,
        name=f"Agent {agent_id}",
        scope=scope,
        source=AgentSource.AGENT_APP,
        status=status,
        app_id=f"backing-{agent_id}",
        created_by="account-1",
    )


@pytest.fixture
def agent_tag_workspaces(sqlite_session_factory: sessionmaker[Session]) -> None:
    """Persist the workspace rows on which Agent-pool write transactions serialize."""
    with sqlite_session_factory.begin() as session:
        first = Tenant(name="First workspace")
        first.id = "workspace-1"
        second = Tenant(name="Second workspace")
        second.id = "workspace-2"
        session.add_all([first, second])


@pytest.mark.usefixtures("agent_tag_workspaces")
def test_agent_bindings_use_canonical_identity_and_an_independent_tag_pool(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Bind draft Agents idempotently while rejecting tags from other owners and pools."""
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _agent("agent-1"),
                _agent("agent-2"),
                _tag("agent-tag", workspace_id="workspace-1", tag_type=TagType.AGENT, name="Research"),
                _tag("app-tag", workspace_id="workspace-1", tag_type=TagType.APP, name="Research"),
                _tag("foreign-tag", workspace_id="workspace-2", tag_type=TagType.AGENT, name="Research"),
            ]
        )
    repository = TagRepository(sqlite_session_factory)
    first_binding = TagBindingInput(("agent-tag", "agent-tag", "app-tag", "foreign-tag"), "agent-1", TagKind.AGENT)
    repository.create_bindings("workspace-1", "account-1", first_binding)
    repository.create_bindings("workspace-1", "account-1", first_binding)
    repository.create_bindings("workspace-1", "account-1", TagBindingInput(("agent-tag",), "agent-2", TagKind.AGENT))

    assert repository.list_tags("workspace-1", "agent", None) == (("agent-tag", "Research", "agent", 2),)
    repository.delete_bindings("workspace-1", first_binding)
    with sqlite_session_factory() as session:
        assert session.scalars(select(TagBinding.target_id).where(TagBinding.tag_id == "agent-tag")).all() == [
            "agent-2"
        ]
    repository.update_tag("workspace-1", "agent-tag", UpdateTagInput("Renamed"))
    assert repository.list_tags("workspace-1", "agent", None) == (("agent-tag", "Renamed", "agent", 1),)
    assert repository.list_tags("workspace-1", "app", None) == (("app-tag", "Research", "app", 0),)
    repository.delete_tag("workspace-1", "agent-tag")
    with sqlite_session_factory() as session:
        assert session.scalar(select(TagBinding.id).where(TagBinding.tag_id == "agent-tag")) is None
        assert session.scalar(select(Tag.id).where(Tag.id == "app-tag")) == "app-tag"


@pytest.mark.parametrize("target_id", ["missing", "backing-valid", "archived", "inline", "foreign"])
@pytest.mark.usefixtures("agent_tag_workspaces")
def test_agent_bindings_reject_unavailable_or_non_roster_identities(
    sqlite_session_factory: sessionmaker[Session], target_id: str
) -> None:
    """Reject invalid Agent identities for both bind and unbind without mutation."""
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _agent("valid"),
                _agent("archived", status=AgentStatus.ARCHIVED),
                _agent("inline", scope=AgentScope.WORKFLOW_ONLY),
                _agent("foreign", workspace_id="workspace-2"),
                _tag("agent-tag", workspace_id="workspace-1", tag_type=TagType.AGENT, name="Research"),
            ]
        )
    repository = TagRepository(sqlite_session_factory)
    binding = TagBindingInput(("agent-tag",), target_id, TagKind.AGENT)
    with pytest.raises(TagBindingTargetNotFoundError, match="Agent not found"):
        repository.create_bindings("workspace-1", "account-1", binding)
    with pytest.raises(TagBindingTargetNotFoundError, match="Agent not found"):
        repository.delete_bindings("workspace-1", binding)
    with sqlite_session_factory() as session:
        assert session.scalar(select(TagBinding.id)) is None


@pytest.mark.usefixtures("agent_tag_workspaces")
def test_agent_tag_names_are_unique_within_the_pool_and_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Reject duplicate Agent names while permitting the same name in independent pools."""
    repository = TagRepository(sqlite_session_factory)
    repository.create_tag("workspace-1", "account-1", CreateTagInput("Research", TagKind.AGENT))
    repository.create_tag("workspace-1", "account-1", CreateTagInput("Research", TagKind.APP))
    repository.create_tag("workspace-2", "account-1", CreateTagInput("Research", TagKind.AGENT))
    second = repository.create_tag("workspace-1", "account-1", CreateTagInput("Finance", TagKind.AGENT))
    with pytest.raises(TagNameConflictError):
        repository.create_tag("workspace-1", "account-1", CreateTagInput("Research", TagKind.AGENT))
    with pytest.raises(TagNameConflictError):
        repository.update_tag("workspace-1", second.id, UpdateTagInput("Research"))
    assert {tag.name for tag in repository.list_tags("workspace-1", "agent", None)} == {"Finance", "Research"}


def test_bulk_agent_tags_scope_both_tables_and_return_sorted_detached_values(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Ignore foreign bindings and tag rows, de-duplicate labels, and sort one batched result."""
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _tag("z-tag", workspace_id="workspace-1", tag_type=TagType.AGENT, name="Zebra"),
                _tag("a-tag", workspace_id="workspace-1", tag_type=TagType.AGENT, name="Alpha"),
                _tag("foreign-tag", workspace_id="workspace-2", tag_type=TagType.AGENT, name="Foreign"),
                _tag("app-tag", workspace_id="workspace-1", tag_type=TagType.APP, name="Studio"),
                TagBinding(tenant_id="workspace-1", target_id="agent-1", tag_id="z-tag", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", target_id="agent-1", tag_id="a-tag", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", target_id="agent-1", tag_id="a-tag", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", target_id="agent-2", tag_id="z-tag", created_by="account-1"),
                TagBinding(tenant_id="workspace-2", target_id="agent-1", tag_id="z-tag", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", target_id="agent-1", tag_id="foreign-tag", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", target_id="agent-1", tag_id="app-tag", created_by="account-1"),
            ]
        )
    with sqlite_session_factory() as session:
        tags = TagRepository.load_tags_for_targets(
            session, tenant_id="workspace-1", tag_type="agent", target_ids=["agent-1", "agent-2", "untagged"]
        )
    assert tags == {
        "agent-1": [
            {"id": "a-tag", "name": "Alpha", "type": "agent"},
            {"id": "z-tag", "name": "Zebra", "type": "agent"},
        ],
        "agent-2": [{"id": "z-tag", "name": "Zebra", "type": "agent"}],
    }


def test_bulk_tags_with_empty_targets_does_not_need_a_bound_session() -> None:
    """An empty page must return no labels without issuing SQL."""
    with Session() as session:
        assert (
            TagRepository.load_tags_for_targets(session, tenant_id="workspace-1", tag_type="agent", target_ids=[]) == {}
        )
