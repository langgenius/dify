"""SQLite transaction coverage for icon-owner upload cleanup hooks."""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from enum import StrEnum

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

import tasks.clean_upload_files_task as cleanup_task_module
from models.account import Account, Tenant
from models.agent import Agent, AgentIconType, AgentKind, AgentScope, AgentSource
from models.dataset import Dataset, PipelineCustomizedTemplate
from models.enums import CustomizeTokenStrategy
from models.model import App, IconType, Site, UploadFile
from models.snippet import CustomizedSnippet, SnippetType
from models.tools import MCPToolProvider
from repositories.knowledge.upload_file_repository import (
    register_upload_file_reference_guards,
)
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_app, make_dataset, make_tenant, make_upload_file

IconOwner = (
    App | Site | Account | Tenant | Dataset | PipelineCustomizedTemplate | Agent | CustomizedSnippet | MCPToolProvider
)


class IconOwnerKind(StrEnum):
    APP = "app"
    SITE = "site"
    ACCOUNT = "account"
    TENANT = "tenant"
    DATASET = "dataset"
    PIPELINE_TEMPLATE = "pipeline_template"
    AGENT = "agent"
    SNIPPET = "snippet"
    MCP = "mcp"


@dataclass(frozen=True)
class OwnerSetup:
    owner: IconOwner
    tenant_id: str
    dependencies: tuple[object, ...] = ()


@dataclass
class RecordingStorage:
    deleted_keys: list[str] = field(default_factory=list)

    def delete(self, key: str) -> None:
        self.deleted_keys.append(key)


def _icon_info(file_id: str | None) -> dict[str, str] | None:
    if file_id is None:
        return None
    return {"icon_type": "image", "icon": file_id, "icon_url": "/preview"}


def _tenant_config(file_id: str | None) -> str:
    return json.dumps({"remove_webapp_brand": False, "replace_webapp_logo": file_id})


def _build_owner(kind: IconOwnerKind, *, file_id: str, suffix: str = "one") -> OwnerSetup:
    tenant_id = f"tenant-{suffix}"
    if kind is IconOwnerKind.APP:
        return OwnerSetup(
            owner=make_app(
                app_id=f"app-{suffix}",
                tenant_id=tenant_id,
                name=f"App {suffix}",
                icon_type=IconType.IMAGE,
                icon=file_id,
            ),
            tenant_id=tenant_id,
        )
    if kind is IconOwnerKind.SITE:
        app = make_app(app_id=f"app-{suffix}", tenant_id=tenant_id, name=f"App {suffix}")
        site = Site(
            app_id=app.id,
            title=f"Site {suffix}",
            default_language="en-US",
            customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            icon_type=IconType.IMAGE,
            icon=file_id,
        )
        return OwnerSetup(owner=site, tenant_id=tenant_id, dependencies=(app,))
    if kind is IconOwnerKind.ACCOUNT:
        account = make_account(account_id=f"account-{suffix}", email=f"{suffix}@example.com")
        account.avatar = file_id
        return OwnerSetup(owner=account, tenant_id=tenant_id)
    if kind is IconOwnerKind.TENANT:
        tenant = make_tenant(tenant_id=tenant_id, name=f"Tenant {suffix}")
        tenant.custom_config = _tenant_config(file_id)
        return OwnerSetup(owner=tenant, tenant_id=tenant_id)
    if kind is IconOwnerKind.DATASET:
        return OwnerSetup(
            owner=make_dataset(
                dataset_id=f"dataset-{suffix}",
                tenant_id=tenant_id,
                name=f"Dataset {suffix}",
                icon_info=_icon_info(file_id),
            ),
            tenant_id=tenant_id,
        )
    if kind is IconOwnerKind.PIPELINE_TEMPLATE:
        return OwnerSetup(
            owner=PipelineCustomizedTemplate(
                tenant_id=tenant_id,
                name=f"Template {suffix}",
                description="",
                chunk_structure="paragraph",
                icon=_icon_info(file_id) or {},
                position=1,
                yaml_content="",
                install_count=0,
                language="en-US",
                created_by="account-1",
            ),
            tenant_id=tenant_id,
        )
    if kind is IconOwnerKind.AGENT:
        return OwnerSetup(
            owner=Agent(
                tenant_id=tenant_id,
                name=f"Agent {suffix}",
                description="",
                role="",
                icon_type=AgentIconType.IMAGE,
                icon=file_id,
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.ROSTER,
                created_by="account-1",
            ),
            tenant_id=tenant_id,
        )
    if kind is IconOwnerKind.SNIPPET:
        return OwnerSetup(
            owner=CustomizedSnippet(
                tenant_id=tenant_id,
                name=f"Snippet {suffix}",
                description="",
                type=SnippetType.NODE.value,
                icon_info=_icon_info(file_id),
                created_by="account-1",
            ),
            tenant_id=tenant_id,
        )
    if kind is IconOwnerKind.MCP:
        return OwnerSetup(
            owner=MCPToolProvider(
                tenant_id=tenant_id,
                name=f"MCP {suffix}",
                server_identifier=f"mcp-{suffix}",
                server_url="encrypted",
                server_url_hash=f"hash-{suffix}",
                icon=file_id,
                user_id="account-1",
            ),
            tenant_id=tenant_id,
        )
    raise AssertionError(f"unsupported icon owner kind: {kind}")


def _set_owner_reference(owner: IconOwner, file_id: str | None) -> None:
    if isinstance(owner, (App, Site)):
        owner.icon_type = IconType.IMAGE if file_id is not None else None
        owner.icon = file_id
    elif isinstance(owner, Account):
        owner.avatar = file_id
    elif isinstance(owner, Tenant):
        owner.custom_config = _tenant_config(file_id)
    elif isinstance(owner, Dataset):
        owner.icon_info = _icon_info(file_id)
    elif isinstance(owner, PipelineCustomizedTemplate):
        owner.icon = _icon_info(file_id) or {}
    elif isinstance(owner, Agent):
        owner.icon_type = AgentIconType.IMAGE if file_id is not None else None
        owner.icon = file_id
    elif isinstance(owner, CustomizedSnippet):
        owner.icon_info = _icon_info(file_id)
    elif isinstance(owner, MCPToolProvider):
        owner.icon = file_id
    else:
        raise AssertionError(f"unsupported icon owner: {type(owner).__name__}")


def _reference_attributes(owner: IconOwner) -> tuple[str, ...]:
    if isinstance(owner, (App, Site, Agent)):
        return ("icon_type", "icon")
    if isinstance(owner, Account):
        return ("avatar",)
    if isinstance(owner, Tenant):
        return ("custom_config",)
    if isinstance(owner, (Dataset, CustomizedSnippet)):
        return ("icon_info",)
    if isinstance(owner, (PipelineCustomizedTemplate, MCPToolProvider)):
        return ("icon",)
    raise AssertionError(f"unsupported icon owner: {type(owner).__name__}")


def _upload_for_owner(setup: OwnerSetup, *, file_id: str, key: str) -> UploadFile:
    created_by = setup.owner.id if isinstance(setup.owner, Account) else "account-1"
    return make_upload_file(
        file_id=file_id,
        tenant_id=setup.tenant_id,
        key=key,
        created_by=created_by,
    )


def _persist_owner_with_uploads(
    session: Session,
    *,
    setup: OwnerSetup,
    uploads: tuple[UploadFile, ...],
) -> None:
    session.add_all([*setup.dependencies, *uploads])
    session.flush()
    session.add(setup.owner)
    session.commit()


@pytest.fixture(autouse=True)
def _registered_upload_file_reference_guards(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    added_listeners: list[tuple[object, str, Callable[..., object]]] = []
    original_listen = event.listen

    def record_listener(
        target: object,
        identifier: str,
        listener: Callable[..., object],
        *args: object,
        **kwargs: object,
    ) -> None:
        was_registered = event.contains(target, identifier, listener)
        original_listen(target, identifier, listener, *args, **kwargs)
        if not was_registered and event.contains(target, identifier, listener):
            added_listeners.append((target, identifier, listener))

    with monkeypatch.context() as patcher:
        patcher.setattr(event, "listen", record_listener)
        register_upload_file_reference_guards()
    try:
        yield
    finally:
        for target, identifier, listener in reversed(added_listeners):
            if event.contains(target, identifier, listener):
                event.remove(target, identifier, listener)


@pytest.mark.parametrize("owner_kind", tuple(IconOwnerKind), ids=str)
@pytest.mark.parametrize("expire_before_assignment", [False, True], ids=("loaded", "expired"))
def test_replacing_icon_reference_marks_old_upload_in_owner_transaction(
    sqlite_session: Session,
    owner_kind: IconOwnerKind,
    expire_before_assignment: bool,
) -> None:
    setup = _build_owner(owner_kind, file_id="old-file")
    old_upload = _upload_for_owner(setup, file_id="old-file", key="icons/old")
    new_upload = _upload_for_owner(setup, file_id="new-file", key="icons/new")
    _persist_owner_with_uploads(sqlite_session, setup=setup, uploads=(old_upload, new_upload))

    if expire_before_assignment:
        sqlite_session.expire(setup.owner, _reference_attributes(setup.owner))
    _set_owner_reference(setup.owner, new_upload.id)
    sqlite_session.flush()

    sqlite_session.expire(old_upload, ("knowledge_cleanup_started_at",))
    sqlite_session.expire(new_upload, ("knowledge_cleanup_started_at",))
    assert old_upload.knowledge_cleanup_started_at is not None
    assert new_upload.knowledge_cleanup_started_at is None


@pytest.mark.parametrize("owner_kind", tuple(IconOwnerKind), ids=str)
def test_deleting_icon_owner_marks_old_upload_in_owner_transaction(
    sqlite_session: Session,
    owner_kind: IconOwnerKind,
) -> None:
    setup = _build_owner(owner_kind, file_id="old-file")
    old_upload = _upload_for_owner(setup, file_id="old-file", key="icons/old")
    _persist_owner_with_uploads(sqlite_session, setup=setup, uploads=(old_upload,))

    sqlite_session.delete(setup.owner)
    sqlite_session.flush()

    sqlite_session.expire(old_upload, ("knowledge_cleanup_started_at",))
    assert old_upload.knowledge_cleanup_started_at is not None


def test_shared_old_reference_is_retained(sqlite_session: Session) -> None:
    first = _build_owner(IconOwnerKind.APP, file_id="old-file", suffix="first")
    second = _build_owner(IconOwnerKind.APP, file_id="old-file", suffix="second")
    old_upload = make_upload_file(file_id="old-file", tenant_id=first.tenant_id, key="icons/old")
    replacement = make_upload_file(file_id="new-file", tenant_id=first.tenant_id, key="icons/new")
    assert isinstance(second.owner, App)
    second.owner.tenant_id = first.tenant_id
    sqlite_session.add_all([old_upload, replacement])
    sqlite_session.flush()
    sqlite_session.add_all([first.owner, second.owner])
    sqlite_session.commit()

    _set_owner_reference(first.owner, replacement.id)
    sqlite_session.flush()

    sqlite_session.expire(old_upload, ("knowledge_cleanup_started_at",))
    assert old_upload.knowledge_cleanup_started_at is None


def test_rollback_removes_marker_and_a_later_flush_can_mark_again(sqlite_session: Session) -> None:
    setup = _build_owner(IconOwnerKind.APP, file_id="old-file")
    old_upload = _upload_for_owner(setup, file_id="old-file", key="icons/old")
    replacement = _upload_for_owner(setup, file_id="new-file", key="icons/new")
    _persist_owner_with_uploads(sqlite_session, setup=setup, uploads=(old_upload, replacement))
    owner_id = setup.owner.id

    _set_owner_reference(setup.owner, replacement.id)
    sqlite_session.flush()
    sqlite_session.expire(old_upload, ("knowledge_cleanup_started_at",))
    assert old_upload.knowledge_cleanup_started_at is not None

    sqlite_session.rollback()
    persisted_old = sqlite_session.get_one(UploadFile, old_upload.id)
    persisted_owner = sqlite_session.get_one(App, owner_id)
    assert persisted_old.knowledge_cleanup_started_at is None
    assert persisted_owner.icon == old_upload.id

    _set_owner_reference(persisted_owner, replacement.id)
    sqlite_session.flush()
    sqlite_session.expire(persisted_old, ("knowledge_cleanup_started_at",))
    assert persisted_old.knowledge_cleanup_started_at is not None


def test_fresh_icon_cleanup_marker_is_recovered_when_gate_is_enabled(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    setup = _build_owner(IconOwnerKind.APP, file_id="old-file")
    old_upload = _upload_for_owner(setup, file_id="old-file", key="icons/old")
    replacement = _upload_for_owner(setup, file_id="new-file", key="icons/new")
    _persist_owner_with_uploads(sqlite_session, setup=setup, uploads=(old_upload, replacement))
    old_upload_id = old_upload.id

    _set_owner_reference(setup.owner, replacement.id)
    sqlite_session.commit()
    sqlite_session.expire(old_upload, ("knowledge_cleanup_started_at",))
    assert old_upload.knowledge_cleanup_started_at is not None

    storage = RecordingStorage()
    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=True)
    monkeypatch.setattr(cleanup_task_module, "storage", storage)
    cleanup_task_module.recover_claimed_upload_file_cleanup_task.run()

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, old_upload_id) is None
    assert sqlite_session.get(UploadFile, replacement.id) is not None
    assert storage.deleted_keys == ["icons/old"]
