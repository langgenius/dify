import pytest
from sqlalchemy import Engine, String, Table, UniqueConstraint, select
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Dataset
from models.enums import TagType
from models.model import Tag, TagBinding
from models.skill import Skill
from models.snippet import CustomizedSnippet, SnippetType
from repositories.tag_repository import TagRepository
from services.tag_application_service import (
    CreateTagInput,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagNameConflictError,
    TagNotFoundError,
    UpdateTagInput,
    normalize_tag_name,
)


def _tag(tag_id: str, *, workspace_id: str, tag_type: TagType, name: str) -> Tag:
    tag = Tag(
        tenant_id=workspace_id,
        type=tag_type,
        name=name,
        normalized_name=normalize_tag_name(tag_type.value, name) if tag_type == TagType.SKILL else None,
        created_by="account-1",
    )
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


def test_list_tags_limits_visibility_and_counts_to_allowed_targets(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _tag("shared", workspace_id="workspace-1", tag_type=TagType.KNOWLEDGE, name="Shared"),
                _tag("hidden", workspace_id="workspace-1", tag_type=TagType.KNOWLEDGE, name="Hidden"),
                _tag("unbound", workspace_id="workspace-1", tag_type=TagType.KNOWLEDGE, name="Unbound"),
                TagBinding(tenant_id="workspace-1", tag_id="shared", target_id="allowed-1", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", tag_id="shared", target_id="allowed-2", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", tag_id="shared", target_id="outside", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", tag_id="hidden", target_id="outside", created_by="account-1"),
            ]
        )

    repository = TagRepository(sqlite_session_factory)

    result = repository.list_tags(
        "workspace-1",
        "knowledge",
        None,
        target_ids=frozenset({"allowed-1", "allowed-2"}),
    )

    assert result == (("shared", "Shared", "knowledge", 2),)
    assert repository.list_tags("workspace-1", "knowledge", None, target_ids=frozenset()) == ()


def test_list_tags_by_target_scopes_workspace_type_and_target(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _tag("tag-1", workspace_id="workspace-1", tag_type=TagType.KNOWLEDGE, name="First"),
                _tag("tag-2", workspace_id="workspace-1", tag_type=TagType.APP, name="App"),
                _tag("tag-3", workspace_id="workspace-2", tag_type=TagType.KNOWLEDGE, name="Foreign"),
                TagBinding(tenant_id="workspace-1", tag_id="tag-1", target_id="dataset-1", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", tag_id="tag-1", target_id="dataset-2", created_by="account-1"),
                TagBinding(tenant_id="workspace-1", tag_id="tag-2", target_id="dataset-1", created_by="account-1"),
                TagBinding(tenant_id="workspace-2", tag_id="tag-3", target_id="dataset-1", created_by="account-2"),
            ]
        )

    result = TagRepository(sqlite_session_factory).list_tags_by_target("workspace-1", "dataset-1", "knowledge")

    assert result == (("tag-1", "First", "knowledge", 1),)


def test_tag_lifecycle_uses_owned_transactions_and_workspace_scope(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = TagRepository(sqlite_session_factory)
    created = repository.create_tag("workspace-1", "account-1", CreateTagInput("Original", "knowledge"))

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
        repository.create_tag("workspace-1", "account-1", CreateTagInput("Updated", "knowledge"))

    with pytest.raises(TagNotFoundError):
        repository.update_tag("workspace-2", created.id, UpdateTagInput("Leaked"))

    repository.delete_tag("workspace-1", created.id)
    with sqlite_session_factory() as session:
        assert session.scalar(select(Tag.id).where(Tag.id == created.id)) is None
        assert session.scalar(select(TagBinding.id).where(TagBinding.tag_id == created.id)) is None


def test_tag_name_database_constraint_matches_repository_conflict_contract(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tag_table = Tag.__table__
    assert isinstance(tag_table, Table)
    unique_constraints = {
        constraint.name: tuple(column.name for column in constraint.columns)
        for constraint in tag_table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert unique_constraints["tag_tenant_type_name_unique"] == ("tenant_id", "type", "name")
    assert unique_constraints["tag_tenant_type_normalized_name_unique"] == (
        "tenant_id",
        "type",
        "normalized_name",
    )

    with pytest.raises(IntegrityError):
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    _tag("duplicate-1", workspace_id="workspace-1", tag_type=TagType.KNOWLEDGE, name="Shared"),
                    _tag("duplicate-2", workspace_id="workspace-1", tag_type=TagType.KNOWLEDGE, name="Shared"),
                ]
            )

    repository = TagRepository(sqlite_session_factory)
    original = repository.create_tag("workspace-1", "account-1", CreateTagInput("Shared", "knowledge"))
    renamed = repository.create_tag("workspace-1", "account-1", CreateTagInput("Rename me", "knowledge"))

    with pytest.raises(TagNameConflictError):
        repository.create_tag("workspace-1", "account-1", CreateTagInput("Shared", "knowledge"))
    with pytest.raises(TagNameConflictError):
        repository.update_tag("workspace-1", renamed.id, UpdateTagInput("Shared"))

    assert repository.create_tag("workspace-2", "account-1", CreateTagInput("Shared", "knowledge")).name == "Shared"
    assert repository.create_tag("workspace-1", "account-1", CreateTagInput("Shared", "app")).name == "Shared"
    with sqlite_session_factory() as session:
        assert session.get(Tag, original.id) is not None
        unchanged = session.get(Tag, renamed.id)
        assert unchanged is not None
        assert unchanged.name == "Rename me"


def test_skill_tag_identity_is_casefolded_without_changing_other_tag_types(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = TagRepository(sqlite_session_factory)
    skill_tag = repository.create_tag("workspace-1", "account-1", CreateTagInput("Shared", "skill"))

    with pytest.raises(TagNameConflictError):
        repository.create_tag("workspace-1", "account-1", CreateTagInput("shared", "skill"))

    upper = repository.create_tag("workspace-1", "account-1", CreateTagInput("Shared", "knowledge"))
    lower = repository.create_tag("workspace-1", "account-1", CreateTagInput("shared", "knowledge"))
    spaced = repository.create_tag("workspace-1", "account-1", CreateTagInput("Shared ", "knowledge"))
    assert len({upper.id, lower.id, spaced.id}) == 3
    with sqlite_session_factory() as session:
        persisted = session.get(Tag, skill_tag.id)
        assert persisted is not None
        assert persisted.normalized_name == "shared"


def test_skill_tag_identity_normalizes_canonical_unicode_without_discarding_accents(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = TagRepository(sqlite_session_factory)
    accented = repository.create_tag(
        "workspace-1", "account-1", CreateTagInput("Cafe\N{COMBINING ACUTE ACCENT}", "skill")
    )

    with pytest.raises(TagNameConflictError):
        repository.create_tag(
            "workspace-1", "account-1", CreateTagInput("Caf\N{LATIN SMALL LETTER E WITH ACUTE}", "skill")
        )

    unaccented = repository.create_tag("workspace-1", "account-1", CreateTagInput("Cafe", "skill"))
    assert accented.id != unaccented.id
    with sqlite_session_factory() as session:
        persisted_accented = session.get(Tag, accented.id)
        persisted_unaccented = session.get(Tag, unaccented.id)
        assert persisted_accented is not None
        assert persisted_unaccented is not None
        assert persisted_accented.normalized_name == "caf\N{LATIN SMALL LETTER E WITH ACUTE}"
        assert persisted_unaccented.normalized_name == "cafe"


def test_tag_identity_columns_use_binary_mysql_collation() -> None:
    dialect = mysql.dialect()
    name_type = Tag.__table__.c.name.type.dialect_impl(dialect)
    normalized_name_type = Tag.__table__.c.normalized_name.type.dialect_impl(dialect)

    assert isinstance(name_type, String)
    assert isinstance(normalized_name_type, String)
    assert name_type.collation == "utf8mb4_0900_bin"
    assert normalized_name_type.collation == "utf8mb4_0900_bin"


def test_skill_tag_rename_updates_casefolded_identity(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = TagRepository(sqlite_session_factory)
    skill_tag = repository.create_tag("workspace-1", "account-1", CreateTagInput("Original", "skill"))

    updated = repository.update_tag(
        "workspace-1",
        skill_tag.id,
        UpdateTagInput("Renamed"),
        expected_type="skill",
    )

    assert updated.name == "Renamed"
    with pytest.raises(TagNameConflictError):
        repository.create_tag("workspace-1", "account-1", CreateTagInput("RENAMED", "skill"))
    with sqlite_session_factory() as session:
        persisted = session.get(Tag, skill_tag.id)
        assert persisted is not None
        assert persisted.normalized_name == "renamed"


def test_tag_binding_database_constraint_matches_idempotent_repository_contract(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    binding_table = TagBinding.__table__
    assert isinstance(binding_table, Table)
    unique_constraints = {
        constraint.name: tuple(column.name for column in constraint.columns)
        for constraint in binding_table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert unique_constraints["tag_binding_tenant_tag_target_unique"] == ("tenant_id", "tag_id", "target_id")

    with pytest.raises(IntegrityError):
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    TagBinding(
                        tenant_id="workspace-1",
                        tag_id="tag-1",
                        target_id="target-1",
                        created_by="account-1",
                    ),
                    TagBinding(
                        tenant_id="workspace-1",
                        tag_id="tag-1",
                        target_id="target-1",
                        created_by="account-2",
                    ),
                ]
            )


def test_update_and_delete_enforce_expected_tag_type_atomically(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_tag("app-tag", workspace_id="workspace-1", tag_type=TagType.APP, name="App"))

    repository = TagRepository(sqlite_session_factory)
    with pytest.raises(TagNotFoundError):
        repository.update_tag(
            "workspace-1",
            "app-tag",
            UpdateTagInput("Changed"),
            expected_type="knowledge",
        )
    with pytest.raises(TagNotFoundError):
        repository.delete_tag("workspace-1", "app-tag", expected_type="knowledge")

    with sqlite_session_factory() as session:
        tag = session.get(Tag, "app-tag")
        assert tag is not None
        assert tag.name == "App"


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
    binding = TagBindingInput(("tag-1", "tag-1", "tag-2", "tag-3"), "snippet-1", "snippet")
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
            TagBindingInput(("tag-1",), "missing", "snippet"),
        )


def test_knowledge_binding_requires_a_tenant_owned_dataset(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                Dataset(id="dataset-1", tenant_id="workspace-1", name="Dataset", created_by="account-1"),
                _tag("tag-1", workspace_id="workspace-1", tag_type=TagType.KNOWLEDGE, name="Knowledge"),
            ]
        )

    repository = TagRepository(sqlite_session_factory)
    with pytest.raises(TagBindingTargetNotFoundError, match="Dataset not found"):
        repository.create_bindings(
            "workspace-2",
            "account-2",
            TagBindingInput(("tag-1",), "dataset-1", "knowledge"),
        )

    repository.create_bindings(
        "workspace-1",
        "account-1",
        TagBindingInput(("tag-1",), "dataset-1", "knowledge"),
    )
    with sqlite_session_factory() as session:
        binding = session.scalar(select(TagBinding).where(TagBinding.target_id == "dataset-1"))
        assert binding is not None
        assert binding.tenant_id == "workspace-1"


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
    binding = TagBindingInput(("tag-1", "tag-2", "tag-3"), "skill-1", "skill")
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
            TagBindingInput(("tag-1",), "missing", "skill"),
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
