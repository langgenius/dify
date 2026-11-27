"""Focused tests for the Agent Soul-backed config service."""

from __future__ import annotations

import io
import zipfile
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import datetime
from functools import partial
from http import HTTPStatus
from pathlib import Path
from types import SimpleNamespace
from typing import override
from unittest.mock import patch

import pytest
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import CreateRunRequest
from sqlalchemy import Select, event, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from typing_extensions import TypedDict

from clients.agent_backend import AgentBackendAgentAppRunInput, AgentBackendModelConfig, AgentBackendRunRequestBuilder
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from extensions.storage.storage_type import StorageType
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
)
from models.agent_config_entities import (
    AgentConfigFileRefConfig,
    AgentConfigSkillRefConfig,
    AgentEnvVariableConfig,
    AgentFileRefConfig,
    AgentSoulConfig,
)
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.tools import ToolFile
from repositories.agent.agent_config_repository import AgentConfigRepository
from repositories.file_grant_repository import FileGrantRepository
from services.agent.agent_config_contracts import AgentConfigVersionKind
from services.agent.config_assets_store import AgentConfigTarget
from services.agent.config_service import (
    AgentConfigService,
    AgentConfigServiceError,
    ConfigDownloadRequest,
    ConfigPushPayload,
    ConfigPushSkillItem,
)
from services.agent.skill_package_service import SkillPackageError
from tests.helpers.unit.model_factories import make_upload_file

MODULE = "services.agent.config_service"
TENANT = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT = "22222222-2222-2222-2222-222222222222"
AGENT = "33333333-3333-3333-3333-333333333333"
USER = "44444444-4444-4444-4444-444444444444"
END_USER = "55555555-5555-5555-5555-555555555555"
SNAPSHOT = "66666666-6666-6666-6666-666666666666"
DRAFT = "77777777-7777-7777-7777-777777777777"
BUILD_DRAFT = "88888888-8888-8888-8888-888888888888"
TOOL_FILE = "99999999-9999-9999-9999-999999999999"
SKILL_FILE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
UPLOAD_FILE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
NORMALIZED_SKILL_FILE = "cccccccc-cccc-cccc-cccc-cccccccccccc"

AGENT_CONFIG_TABLES = (Agent, AgentConfigDraft, AgentConfigSnapshot)


class _PromptTarget(TypedDict, closed=True):
    tenant_id: str
    agent_id: str
    user_id: str
    config_version_id: str
    config_version_kind: AgentConfigVersionKind


def _soul(**updates) -> AgentSoulConfig:
    payload = AgentSoulConfig().model_dump(mode="json")
    payload.update(updates)
    return AgentSoulConfig.model_validate(payload)


def _agent(*, tenant_id: str = TENANT) -> Agent:
    return Agent(
        id=AGENT,
        tenant_id=tenant_id,
        name="Config Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )


def _draft(
    *,
    version_id: str = DRAFT,
    draft_type: AgentConfigDraftType = AgentConfigDraftType.DRAFT,
    account_id: str | None = None,
    soul: AgentSoulConfig | None = None,
) -> AgentConfigDraft:
    return AgentConfigDraft(
        id=version_id,
        tenant_id=TENANT,
        agent_id=AGENT,
        draft_type=draft_type,
        account_id=account_id,
        draft_owner_key=account_id or "",
        config_snapshot=soul or _soul(),
    )


def _snapshot(*, soul: AgentSoulConfig | None = None) -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id=SNAPSHOT,
        tenant_id=TENANT,
        agent_id=AGENT,
        version=1,
        config_snapshot=soul or _soul(),
    )


def _service(sqlite_session: Session) -> AgentConfigService:
    """Bind the real repositories to the current test's isolated SQLite engine."""

    return _service_for_sessions(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))


def _service_for_sessions(
    sessions: sessionmaker[Session], *, write_session: Session | None = None
) -> AgentConfigService:
    """Use a preloaded writer session to test locks, or open fresh SQLite sessions by default."""
    return AgentConfigService(
        configs=AgentConfigRepository(
            session_factory=(lambda: write_session) if write_session is not None else sessions
        ),
        files=FileGrantRepository(session_factory=sessions),
    )


def _persist_target(
    sqlite_session: Session,
    version: AgentConfigDraft | AgentConfigSnapshot,
    *,
    tenant_id: str = TENANT,
) -> None:
    sqlite_session.add_all([_agent(tenant_id=tenant_id), version])
    sqlite_session.commit()


@contextmanager
def _observe_config_storage_reads(
    root: Path, sessions: sessionmaker[Session]
) -> Generator[tuple[OpenDALStorage, list[bool]]]:
    """Use a real filesystem backend and record whether a repository query transaction is open at each read."""
    query_sessions: set[Session] = set()
    read_transactions: list[bool] = []

    def record_query(state: ORMExecuteState) -> None:
        """Record actual repository sessions during the operation under test."""
        if state.is_select:
            query_sessions.add(state.session)

    class ObservedStorage(OpenDALStorage):
        @override
        def load_once(self, filename: str) -> bytes:
            """Observe verified database activity, then read the actual file on disk."""
            assert query_sessions
            read_transactions.append(any(session.in_transaction() for session in query_sessions))
            return super().load_once(filename)

    local_storage = ObservedStorage(scheme="fs", root=str(root))
    previous_runner = storage.storage_runner if "storage_runner" in vars(storage) else None
    event.listen(sessions, "do_orm_execute", record_query)
    storage.storage_runner = local_storage
    try:
        yield local_storage, read_transactions
    finally:
        event.remove(sessions, "do_orm_execute", record_query)
        if previous_runner is None:
            del storage.storage_runner
        else:
            storage.storage_runner = previous_runner


def _target(
    *,
    kind: AgentConfigVersionKind,
    writable: bool,
    version_id: str = "version-1",
    soul: AgentSoulConfig | None = None,
) -> AgentConfigTarget:
    agent_soul = soul or _soul()
    return AgentConfigTarget(
        tenant_id=TENANT,
        agent_id=AGENT,
        version_id=version_id,
        kind=kind,
        writable=writable,
        agent_soul=agent_soul,
    )


@pytest.mark.parametrize("kind", list(AgentConfigVersionKind))
@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_get_prompt_returns_raw_text_for_each_visible_version(
    kind: AgentConfigVersionKind, sqlite_session: Session
) -> None:
    prompt = "  请参考 [§skill:research:Research§] 和 [§file:guide.md:Guide§]。\r\n\n"
    soul = _soul(prompt={"system_prompt": prompt})
    version = (
        _snapshot(soul=soul)
        if kind == AgentConfigVersionKind.SNAPSHOT
        else _draft(
            soul=soul,
            draft_type=AgentConfigDraftType.DEBUG_BUILD
            if kind == AgentConfigVersionKind.BUILD_DRAFT
            else AgentConfigDraftType.DRAFT,
            account_id=USER if kind == AgentConfigVersionKind.BUILD_DRAFT else None,
        )
    )
    _persist_target(sqlite_session, version)
    target: _PromptTarget = {
        "tenant_id": TENANT,
        "agent_id": AGENT,
        "config_version_id": version.id,
        "config_version_kind": kind,
        "user_id": USER,
    }

    service = _service(sqlite_session)
    assert service.get_prompt(**target) == {"prompt": prompt}
    assert "prompt" not in service.manifest(**target)


@pytest.mark.parametrize("prompt", ["  新提示 🪷 [§skill:research:Research§]\r\n\n", ""])
@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_update_prompt_persists_only_system_prompt_and_keeps_built_requests(
    prompt: str, sqlite_session: Session
) -> None:
    original = _soul(
        prompt={"system_prompt": "Original instructions"},
        config_note="Keep this note",
        config_files=[AgentConfigFileRefConfig(name="guide.md", file_kind="upload_file", file_id=UPLOAD_FILE)],
        config_skills=[AgentConfigSkillRefConfig(name="research", file_id=SKILL_FILE, description="Research")],
        env={"variables": [{"name": "API_KEY", "value": "configured"}]},
        model={
            "plugin_id": "langgenius/openai",
            "model_provider": "openai",
            "model": "gpt-test",
            "model_settings": {"temperature": 0.2},
        },
    )
    _persist_target(
        sqlite_session,
        _draft(version_id=BUILD_DRAFT, draft_type=AgentConfigDraftType.DEBUG_BUILD, account_id=USER, soul=original),
    )
    service = _service(sqlite_session)
    target: _PromptTarget = {
        "tenant_id": TENANT,
        "agent_id": AGENT,
        "user_id": USER,
        "config_version_id": BUILD_DRAFT,
        "config_version_kind": AgentConfigVersionKind.BUILD_DRAFT,
    }
    before = service.resolve_target(**target).agent_soul

    def build_request(soul: AgentSoulConfig) -> CreateRunRequest:
        return AgentBackendRunRequestBuilder().build_for_agent_app(
            AgentBackendAgentAppRunInput(
                model=AgentBackendModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
                execution_context=DifyExecutionContextLayerConfig(
                    tenant_id=TENANT, user_id=USER, user_from="account", agent_mode="agent_app", invoke_from="debugger"
                ),
                backend_binding_ref="binding-1",
                user_prompt="Continue",
                agent_config_version_kind="build_draft",
                agent_soul_prompt=soul.prompt.system_prompt,
            )
        )

    built_request = build_request(before)
    built_payload = built_request.model_dump(mode="json")
    assert service.update_prompt(**target, prompt=prompt) == {"prompt": prompt}
    assert service.get_prompt(**target) == {"prompt": prompt}

    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, BUILD_DRAFT)
    assert persisted is not None
    expected = original.model_dump(mode="json")
    expected["prompt"]["system_prompt"] = prompt
    assert persisted.config_snapshot_dict == expected
    assert before == original
    assert built_request.model_dump(mode="json") == built_payload
    next_request = build_request(service.resolve_target(**target).agent_soul)
    assert next_request.model_dump(mode="json") != built_payload
    assert "Original instructions" not in next_request.model_dump_json()
    next_prompt = next(
        layer.config["prefix"] for layer in next_request.composition.layers if layer.name == "agent_soul_prompt"
    )
    assert isinstance(next_prompt, str)
    assert (prompt.strip() if prompt else "No task prompt was provided.") in next_prompt


@pytest.mark.parametrize("kind", [AgentConfigVersionKind.SNAPSHOT, AgentConfigVersionKind.DRAFT])
@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_update_prompt_rejects_read_only_versions(kind: AgentConfigVersionKind, sqlite_session: Session) -> None:
    soul = _soul(prompt={"system_prompt": "unchanged"})
    version = _snapshot(soul=soul) if kind == AgentConfigVersionKind.SNAPSHOT else _draft(soul=soul)
    _persist_target(sqlite_session, version)

    with pytest.raises(AgentConfigServiceError) as exc_info:
        _service(sqlite_session).update_prompt(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=version.id,
            config_version_kind=kind,
            prompt="replacement",
        )

    assert (exc_info.value.code, exc_info.value.status_code) == ("config_not_writable", 403)
    sqlite_session.refresh(version)
    assert version.config_snapshot_dict == soul.model_dump(mode="json")


@pytest.mark.parametrize("operation", ["get_prompt", "update_prompt"])
@pytest.mark.parametrize(
    "mismatch", ["tenant", "agent", "version_tenant", "version_agent", "account", "missing_account", "version", "kind"]
)
@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_prompt_access_requires_complete_owner_chain(operation: str, mismatch: str, sqlite_session: Session) -> None:
    version = _draft(
        version_id=BUILD_DRAFT,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id=USER,
        soul=_soul(prompt={"system_prompt": "private"}),
    )
    if mismatch == "version_tenant":
        version.tenant_id = OTHER_TENANT
    if mismatch == "version_agent":
        version.agent_id = END_USER
    _persist_target(sqlite_session, version)
    target: _PromptTarget = {
        "tenant_id": OTHER_TENANT if mismatch == "tenant" else TENANT,
        "agent_id": END_USER if mismatch == "agent" else AGENT,
        "user_id": "" if mismatch == "missing_account" else END_USER if mismatch == "account" else USER,
        "config_version_id": SNAPSHOT if mismatch == "version" else BUILD_DRAFT,
        "config_version_kind": AgentConfigVersionKind.DRAFT
        if mismatch == "kind"
        else AgentConfigVersionKind.BUILD_DRAFT,
    }
    service = _service(sqlite_session)

    def call() -> dict[str, str]:
        if operation == "get_prompt":
            return service.get_prompt(**target)
        return service.update_prompt(**target, prompt="replacement")

    with pytest.raises(AgentConfigServiceError) as exc_info:
        call()

    assert exc_info.value.status_code == (400 if mismatch == "missing_account" else 404)
    sqlite_session.refresh(version)
    assert version.config_snapshot.prompt.system_prompt == "private"


def _zip_bytes(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in members.items():
            zip_info = zipfile.ZipInfo(filename=name)
            zip_info.date_time = (1980, 1, 1, 0, 0, 0)
            archive.writestr(zip_info, payload)
    return buffer.getvalue()


@pytest.mark.parametrize(
    ("kind", "user_id", "version_id", "expected_writable"),
    [
        (AgentConfigVersionKind.SNAPSHOT, None, SNAPSHOT, False),
        (AgentConfigVersionKind.DRAFT, USER, DRAFT, False),
        (AgentConfigVersionKind.BUILD_DRAFT, USER, BUILD_DRAFT, True),
    ],
)
@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_resolve_target_supports_snapshot_draft_and_build_draft(
    kind: AgentConfigVersionKind,
    user_id: str | None,
    version_id: str,
    expected_writable: bool,
    sqlite_session: Session,
) -> None:
    if kind == AgentConfigVersionKind.SNAPSHOT:
        version = _snapshot()
    else:
        version = _draft(
            version_id=version_id,
            draft_type=(
                AgentConfigDraftType.DEBUG_BUILD
                if kind == AgentConfigVersionKind.BUILD_DRAFT
                else AgentConfigDraftType.DRAFT
            ),
            account_id=USER if kind == AgentConfigVersionKind.BUILD_DRAFT else None,
        )
    _persist_target(sqlite_session, version)

    target = _service(sqlite_session).resolve_target(
        tenant_id=TENANT,
        agent_id=AGENT,
        config_version_id=version_id,
        config_version_kind=kind,
        user_id=user_id,
    )

    assert target.agent_id == AGENT
    assert target.version_id == version_id
    assert target.kind == kind
    assert target.writable is expected_writable
    assert target.agent_soul == _soul()


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_resolve_target_requires_user_for_build_draft(sqlite_session: Session) -> None:
    _persist_target(
        sqlite_session,
        _draft(
            version_id=BUILD_DRAFT,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id=USER,
        ),
    )

    with pytest.raises(AgentConfigServiceError, match="user_id is required") as exc_info:
        _service(sqlite_session).resolve_target(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id=BUILD_DRAFT,
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
        )

    assert exc_info.value.code == "missing_user_id"


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_resolve_target_hides_build_draft_from_another_user(sqlite_session: Session) -> None:
    _persist_target(
        sqlite_session,
        _draft(
            version_id=BUILD_DRAFT,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id=USER,
        ),
    )

    with pytest.raises(AgentConfigServiceError) as exc_info:
        _service(sqlite_session).resolve_target(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id=BUILD_DRAFT,
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            user_id=END_USER,
        )

    assert (exc_info.value.code, exc_info.value.status_code) == ("config_version_not_found", 404)


@pytest.mark.parametrize(
    ("agent_tenant_id", "expected_code"),
    [
        (OTHER_TENANT, "agent_not_found"),
        (TENANT, "config_version_not_found"),
    ],
)
@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_resolve_target_maps_missing_agent_and_version(
    agent_tenant_id: str,
    expected_code: str,
    sqlite_session: Session,
) -> None:
    sqlite_session.add(_agent(tenant_id=agent_tenant_id))
    sqlite_session.commit()

    with pytest.raises(AgentConfigServiceError) as exc_info:
        _service(sqlite_session).resolve_target(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id=SNAPSHOT,
            config_version_kind=AgentConfigVersionKind.SNAPSHOT,
            user_id=USER,
        )

    assert exc_info.value.code == expected_code


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_push_rejects_non_build_draft_writes(sqlite_session: Session) -> None:
    _persist_target(sqlite_session, _draft(soul=_soul(config_note="before")))

    with pytest.raises(AgentConfigServiceError, match="build drafts") as exc_info:
        _service(sqlite_session).push(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=DRAFT,
            config_version_kind=AgentConfigVersionKind.DRAFT,
            payload=ConfigPushPayload(note="ignored"),
        )

    assert exc_info.value.code == "config_not_writable"
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_note == "before"


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_push_for_console_allows_shared_draft_mutations(sqlite_session: Session) -> None:
    _persist_target(sqlite_session, _draft(soul=_soul(config_note="before")))

    manifest = _service(sqlite_session).push_for_console(
        tenant_id=TENANT,
        agent_id=AGENT,
        user_id=USER,
        config_version_id=DRAFT,
        config_version_kind=AgentConfigVersionKind.DRAFT,
        payload=ConfigPushPayload(note="after"),
    )

    assert manifest["note"] == "after"
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_note == "after"


@pytest.mark.parametrize("sqlite_session", [(*AGENT_CONFIG_TABLES, ToolFile)], indirect=True)
def test_push_accepts_tenant_scoped_tool_file_sources_from_different_upload_owner(
    sqlite_session: Session,
) -> None:
    _persist_target(
        sqlite_session,
        _draft(
            version_id=BUILD_DRAFT,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id=USER,
        ),
    )
    file_source = ToolFile(
        tenant_id=TENANT,
        user_id=END_USER,
        conversation_id=None,
        size=7,
        mimetype="text/plain",
        file_key="file-key",
        name="guide.txt",
    )
    file_source.id = TOOL_FILE
    skill_source = ToolFile(
        tenant_id=TENANT,
        user_id=END_USER,
        conversation_id=None,
        size=123,
        mimetype="application/zip",
        file_key="skill-key",
        name="alpha.zip",
    )
    skill_source.id = SKILL_FILE
    sqlite_session.add_all([file_source, skill_source])
    sqlite_session.commit()
    skill_ref = AgentConfigSkillRefConfig(
        name="alpha",
        description="Alpha skill",
        file_id=NORMALIZED_SKILL_FILE,
        size=321,
        mime_type="application/zip",
    )
    service = _service(sqlite_session)

    with (
        patch(f"{MODULE}.storage.load_once", return_value=b"skill-archive"),
        patch.object(
            service._skill_normalizer,
            "normalize",
            return_value=skill_ref,
        ),
    ):
        manifest = service.push(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=BUILD_DRAFT,
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            payload=ConfigPushPayload.model_validate(
                {
                    "files": [{"name": "guide.txt", "file_ref": {"kind": "tool_file", "id": TOOL_FILE}}],
                    "skills": [{"name": "alpha", "file_ref": {"kind": "tool_file", "id": SKILL_FILE}}],
                }
            ),
        )

    files = manifest["files"]
    skills = manifest["skills"]
    assert isinstance(files, dict)
    assert isinstance(skills, dict)
    assert files["items"][0]["file_id"] == TOOL_FILE
    assert skills["items"][0]["file_id"] == NORMALIZED_SKILL_FILE
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, BUILD_DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_files[0].file_id == TOOL_FILE
    assert persisted.config_snapshot.config_skills[0].file_id == NORMALIZED_SKILL_FILE
    persisted_source = sqlite_session.get(ToolFile, TOOL_FILE)
    assert persisted_source is not None
    assert persisted_source.user_id == END_USER


@pytest.mark.parametrize("sqlite_session", [(*AGENT_CONFIG_TABLES, ToolFile)], indirect=True)
def test_request_download_signs_config_tool_files_without_rechecking_end_user_owner(
    sqlite_session: Session,
) -> None:
    soul = _soul(
        config_files=[AgentConfigFileRefConfig(name="guide.txt", file_kind="tool_file", file_id=TOOL_FILE)],
        config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id=SKILL_FILE)],
    )
    _persist_target(
        sqlite_session,
        _draft(
            version_id=BUILD_DRAFT,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id=USER,
            soul=soul,
        ),
    )
    guide = ToolFile(
        tenant_id=TENANT,
        user_id=END_USER,
        conversation_id=None,
        size=7,
        mimetype="text/plain",
        file_key="tool-files/guide.txt",
        name="guide.txt",
    )
    guide.id = TOOL_FILE
    skill = ToolFile(
        tenant_id=TENANT,
        user_id=END_USER,
        conversation_id=None,
        size=123,
        mimetype="application/zip",
        file_key="tool-files/alpha.zip",
        name="alpha.zip",
    )
    skill.id = SKILL_FILE
    sqlite_session.add_all([guide, skill])
    sqlite_session.commit()
    service = _service(sqlite_session)

    file_download = service.request_download(
        tenant_id=TENANT,
        agent_id=AGENT,
        config_version_id=BUILD_DRAFT,
        config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
        kind="file",
        name="guide.txt",
        user_id=USER,
    )
    skill_download = service.request_download(
        tenant_id=TENANT,
        agent_id=AGENT,
        config_version_id=BUILD_DRAFT,
        config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
        kind="skill",
        name="alpha",
        user_id=USER,
    )

    assert (file_download.filename, file_download.mime_type, file_download.size) == ("guide.txt", "text/plain", 7)
    assert file_download.download_uri.startswith(f"/files/tools/{TOOL_FILE}.txt?")
    assert "as_attachment=true" in file_download.download_uri
    assert (skill_download.filename, skill_download.mime_type, skill_download.size) == (
        "alpha.zip",
        "application/zip",
        123,
    )
    assert skill_download.download_uri.startswith(f"/files/tools/{SKILL_FILE}.zip?")


@pytest.mark.parametrize("sqlite_session", [(*AGENT_CONFIG_TABLES, UploadFile)], indirect=True)
def test_request_download_signs_tenant_scoped_config_upload_file(sqlite_session: Session) -> None:
    soul = _soul(
        config_files=[AgentConfigFileRefConfig(name="guide.txt", file_kind="upload_file", file_id=UPLOAD_FILE)]
    )
    _persist_target(sqlite_session, _draft(soul=soul))
    upload_file = UploadFile(
        tenant_id=TENANT,
        storage_type=StorageType.LOCAL,
        key="uploads/guide.txt",
        name="source-name.txt",
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.END_USER,
        created_by=END_USER,
        created_at=datetime(2025, 1, 1),
        used=False,
    )
    upload_file.id = UPLOAD_FILE
    sqlite_session.add(upload_file)
    sqlite_session.commit()

    result = _service(sqlite_session).request_download(
        tenant_id=TENANT,
        agent_id=AGENT,
        config_version_id=DRAFT,
        config_version_kind=AgentConfigVersionKind.DRAFT,
        kind="file",
        name="guide.txt",
        user_id=USER,
    )

    assert (result.filename, result.mime_type, result.size) == ("guide.txt", "text/plain", 7)
    assert result.download_uri.startswith(f"/files/{UPLOAD_FILE}/file-preview?")
    assert "as_attachment=true" in result.download_uri


@pytest.mark.parametrize("sqlite_session", [(*AGENT_CONFIG_TABLES, ToolFile)], indirect=True)
def test_request_download_rejects_config_source_from_another_tenant(sqlite_session: Session) -> None:
    soul = _soul(config_files=[AgentConfigFileRefConfig(name="guide.txt", file_kind="tool_file", file_id=TOOL_FILE)])
    _persist_target(sqlite_session, _draft(soul=soul))
    source = ToolFile(
        tenant_id=OTHER_TENANT,
        user_id=END_USER,
        conversation_id=None,
        size=7,
        mimetype="text/plain",
        file_key="tool-files/guide.txt",
        name="guide.txt",
    )
    source.id = TOOL_FILE
    sqlite_session.add(source)
    sqlite_session.commit()

    with pytest.raises(AgentConfigServiceError) as exc_info:
        _service(sqlite_session).request_download(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id=DRAFT,
            config_version_kind=AgentConfigVersionKind.DRAFT,
            kind="file",
            name="guide.txt",
            user_id=USER,
        )

    assert (exc_info.value.code, exc_info.value.status_code) == ("config_file_not_found", 404)


@pytest.mark.parametrize(
    ("batch", "error_code", "status"),
    [
        pytest.param(False, "config_not_writable", HTTPStatus.FORBIDDEN, id="single"),
        pytest.param(True, "upload_file_not_found", HTTPStatus.NOT_FOUND, id="batch"),
    ],
)
def test_console_file_upload_preserves_error_order_for_missing_file_and_snapshot(
    sqlite_session: Session, batch: bool, error_code: str, status: HTTPStatus
) -> None:
    """Single upload rejects the immutable target first, while batch checks the source first."""
    _persist_target(sqlite_session, _snapshot())

    service = _service(sqlite_session)
    target: _PromptTarget = {
        "tenant_id": TENANT,
        "agent_id": AGENT,
        "user_id": USER,
        "config_version_id": SNAPSHOT,
        "config_version_kind": AgentConfigVersionKind.SNAPSHOT,
    }
    submit_file = (
        partial(service.push_files_for_console, **target, upload_file_ids=[UPLOAD_FILE])
        if batch
        else partial(service.push_file_for_console, **target, upload_file_id=UPLOAD_FILE)
    )
    with pytest.raises(AgentConfigServiceError) as error:
        submit_file()

    assert (error.value.code, error.value.status_code) == (error_code, status)
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigSnapshot, SNAPSHOT)
    assert persisted is not None
    assert persisted.config_snapshot.config_files == []


@pytest.mark.parametrize("sqlite_session", [(*AGENT_CONFIG_TABLES, UploadFile)], indirect=True)
def test_push_file_for_console_preserves_uploaded_file_metadata(sqlite_session: Session) -> None:
    _persist_target(sqlite_session, _draft())
    upload_file = UploadFile(
        tenant_id=TENANT,
        storage_type=StorageType.LOCAL,
        key="uploads/guide.txt",
        name="guide.txt",
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=USER,
        created_at=datetime(2025, 1, 1),
        used=False,
        hash="sha256:abc",
    )
    upload_file.id = UPLOAD_FILE
    sqlite_session.add(upload_file)
    sqlite_session.commit()

    response = _service(sqlite_session).push_file_for_console(
        tenant_id=TENANT,
        agent_id=AGENT,
        user_id=USER,
        config_version_id=DRAFT,
        config_version_kind=AgentConfigVersionKind.DRAFT,
        upload_file_id=UPLOAD_FILE,
    )

    assert response == {
        "file": {
            "id": "guide.txt",
            "name": "guide.txt",
            "file_id": UPLOAD_FILE,
            "is_missing": False,
            "size": 7,
            "hash": "sha256:abc",
            "mime_type": "text/plain",
        },
        "config_version": {
            "id": DRAFT,
            "kind": "draft",
            "writable": True,
        },
    }
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_files[0].file_id == UPLOAD_FILE


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_upload_skill_for_console_maps_package_validation_failures(sqlite_session: Session) -> None:
    _persist_target(sqlite_session, _draft())
    service = _service(sqlite_session)
    message = "skill package must contain exactly one skill; multiple skill folders in one archive are not supported"

    with patch.object(
        service._skill_normalizer,
        "normalize",
        side_effect=SkillPackageError("files_outside_skill_root", message, status_code=400),
    ):
        with pytest.raises(AgentConfigServiceError, match="exactly one skill") as exc_info:
            service.upload_skill_for_console(
                tenant_id=TENANT,
                agent_id=AGENT,
                user_id=USER,
                config_version_id=DRAFT,
                config_version_kind=AgentConfigVersionKind.DRAFT,
                content=b"bad-archive",
                filename="skills.zip",
            )

    assert exc_info.value.code == "files_outside_skill_root"
    assert exc_info.value.message == message
    assert exc_info.value.status_code == 400
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_skills == []


def test_push_rejects_non_tool_file_skill_refs(sqlite_session: Session) -> None:
    """Reject a valid workspace upload used as a skill archive and leave the draft unchanged."""
    _persist_target(
        sqlite_session, _draft(version_id=BUILD_DRAFT, draft_type=AgentConfigDraftType.DEBUG_BUILD, account_id=USER)
    )
    _persist_upload(sqlite_session, file_id=UPLOAD_FILE, name="alpha.zip")

    with pytest.raises(AgentConfigServiceError, match="tool files") as exc_info:
        _service(sqlite_session).push(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=BUILD_DRAFT,
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            payload=ConfigPushPayload(
                skills=[
                    ConfigPushSkillItem.model_validate(
                        {"name": "alpha", "file_ref": {"kind": "upload_file", "id": UPLOAD_FILE}}
                    )
                ]
            ),
        )

    assert (exc_info.value.code, exc_info.value.status_code) == ("invalid_skill_file_ref", HTTPStatus.BAD_REQUEST)
    sqlite_session.expire_all()
    assert sqlite_session.get_one(AgentConfigDraft, BUILD_DRAFT).config_snapshot.config_skills == []


@pytest.mark.parametrize(
    ("error_code", "message"),
    [
        ("skill_name_mismatch", "skill package name must match the requested config skill name"),
        ("invalid_archive", "skill archive is not a valid zip"),
    ],
)
def test_push_maps_invalid_skill_archive_and_preserves_draft(
    error_code: str,
    message: str,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    tmp_path: Path,
) -> None:
    """Read the workspace archive outside SQL and preserve the draft when real normalization fails."""
    original = _soul(config_note="Keep this note")
    _persist_target(
        sqlite_session,
        _draft(version_id=BUILD_DRAFT, draft_type=AgentConfigDraftType.DEBUG_BUILD, account_id=USER, soul=original),
    )
    archive = (
        _zip_bytes({"SKILL.md": b"---\nname: beta\ndescription: Test skill\n---\n# Skill\n"})
        if error_code == "skill_name_mismatch"
        else b"bad-archive"
    )
    tool_file = ToolFile(
        user_id=END_USER,
        tenant_id=TENANT,
        conversation_id=None,
        file_key="tool-files/alpha.zip",
        mimetype="application/zip",
        name="alpha.zip",
        size=len(archive),
    )
    sqlite_session.add(tool_file)
    sqlite_session.commit()

    with _observe_config_storage_reads(tmp_path, sqlite_session_factory) as (local_storage, read_transactions):
        local_storage.save(tool_file.file_key, archive)
        with pytest.raises(AgentConfigServiceError, match=message) as exc_info:
            _service_for_sessions(sqlite_session_factory).push(
                tenant_id=TENANT,
                agent_id=AGENT,
                user_id=USER,
                config_version_id=BUILD_DRAFT,
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                payload=ConfigPushPayload(
                    skills=[
                        ConfigPushSkillItem.model_validate(
                            {"name": "alpha", "file_ref": {"kind": "tool_file", "id": tool_file.id}}
                        )
                    ],
                    note="This edit should not be saved",
                ),
            )
    assert read_transactions == [False]
    assert (exc_info.value.code, exc_info.value.status_code) == (error_code, HTTPStatus.BAD_REQUEST)
    sqlite_session.expire_all()
    assert sqlite_session.get_one(AgentConfigDraft, BUILD_DRAFT).config_snapshot == original


def test_apply_env_text_supports_delete_comments_export_and_keeps_unmentioned_values() -> None:
    current = [
        AgentEnvVariableConfig(key="KEEP", name="KEEP", value="old"),
        AgentEnvVariableConfig(key="REMOVE", name="REMOVE", value="gone"),
        AgentEnvVariableConfig(key="UNTOUCHED", name="UNTOUCHED", value="still-here"),
    ]

    updated = AgentConfigService._apply_env_text(
        current,
        "# comment\nexport KEEP=new-value\nREMOVE=\nNEW='two words'\n",
    )

    values = {item.key: item.value for item in updated}
    assert values == {
        "KEEP": "new-value",
        "UNTOUCHED": "still-here",
        "NEW": "two words",
    }


@pytest.mark.parametrize(
    "archive_bytes",
    [
        pytest.param(b"not-a-zip-archive", id="not-a-zip-archive"),
        pytest.param(_zip_bytes({"README.md": b"missing skill md"}), id="missing-skill-md"),
    ],
)
def test_inspect_skill_maps_invalid_archives_to_service_errors(sqlite_session: Session, archive_bytes: bytes) -> None:
    service = _service(sqlite_session)
    target = _target(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        writable=True,
        soul=_soul(config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id="tool-file-1")]),
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch.object(service, "_load_tool_file_bytes", return_value=(archive_bytes, "application/zip")),
    ):
        with pytest.raises(AgentConfigServiceError, match="stored config skill archive is invalid") as exc_info:
            service.inspect_skill(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                name="alpha",
                user_id=USER,
            )

    assert exc_info.value.code == "skill_archive_invalid"
    assert exc_info.value.status_code == 500


def test_request_download_falls_back_to_workspace_runtime_skill(sqlite_session: Session) -> None:
    service = _service(sqlite_session)
    target = _target(kind=AgentConfigVersionKind.DRAFT, writable=False, soul=_soul(config_skills=[]))
    expected = SimpleNamespace(
        filename="workspace-skill.zip",
        mime_type="application/zip",
        size=123,
        download_uri="/files/tools/workspace.zip?signature=1",
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch(f"{MODULE}.SkillManagementService") as skill_management_service,
        patch.object(service, "_resolve_download_request", return_value=expected) as resolve_download_request,
    ):
        skill_management_service.return_value.list_runtime_agent_skills.return_value = [
            {
                "name": "workspace-skill",
                "file_id": "workspace-archive-id",
            }
        ]
        download = service.request_download(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id="draft-1",
            config_version_kind=AgentConfigVersionKind.DRAFT,
            kind="skill",
            name="workspace-skill",
            user_id=USER,
        )

    assert download is expected
    resolve_download_request.assert_called_once_with(
        tenant_id=TENANT,
        file_kind="tool_file",
        file_id="workspace-archive-id",
        filename="workspace-skill.zip",
        default_mime_type="application/zip",
        missing_code="config_skill_not_found",
        missing_message="config skill payload is missing",
    )


def test_inspect_skill_falls_back_to_workspace_runtime_skill(sqlite_session: Session) -> None:
    service = _service(sqlite_session)
    target = _target(kind=AgentConfigVersionKind.DRAFT, writable=False, soul=_soul(config_skills=[]))
    archive = _zip_bytes(
        {
            "SKILL.md": b"---\nname: workspace-skill\ndescription: Workspace skill.\n---\n# Workspace",
            "references/policy.md": b"Policy",
        }
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch(f"{MODULE}.SkillManagementService") as skill_management_service,
    ):
        skill_management_service.return_value.pull_runtime_agent_skill.return_value = SimpleNamespace(payload=archive)
        skill_management_service.return_value.list_runtime_agent_skills.return_value = [
            {
                "id": "skill-1",
                "name": "workspace-skill",
                "description": "Workspace skill.",
                "size": len(archive),
                "hash": "hash",
                "mime_type": "application/zip",
            }
        ]
        result = service.inspect_skill(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id="draft-1",
            config_version_kind=AgentConfigVersionKind.DRAFT,
            name="workspace-skill",
            user_id=USER,
        )

    assert result["id"] == "skill-1"
    assert result["source"] == "config_skill_zip"
    assert result["skill_md"]["text"] == "---\nname: workspace-skill\ndescription: Workspace skill.\n---\n# Workspace"
    assert [item["path"] for item in result["files"]] == ["SKILL.md", "references", "references/policy.md"]


def test_manifest_uses_items_shape_without_download_urls() -> None:
    target = _target(
        kind=AgentConfigVersionKind.DRAFT,
        writable=False,
        soul=_soul(
            config_skills=[AgentConfigSkillRefConfig(name="alpha", description="Alpha skill", file_id="tool-file-1")],
            config_files=[AgentConfigFileRefConfig(name="guide.txt", file_kind="upload_file", file_id="upload-file-1")],
            config_note="Use the guide.",
        ),
    )

    with patch(f"{MODULE}.SkillManagementService") as skill_management_service:
        skill_management_service.return_value.list_runtime_agent_skills.return_value = []
        manifest = AgentConfigService._manifest_for_target(target)

    assert manifest == {
        "agent_id": AGENT,
        "config_version": {
            "id": "version-1",
            "kind": "draft",
            "writable": True,
        },
        "skills": {
            "items": [
                {
                    "id": "alpha",
                    "name": "alpha",
                    "file_id": "tool-file-1",
                    "is_missing": False,
                    "description": "Alpha skill",
                    "size": None,
                    "hash": None,
                    "mime_type": "application/zip",
                }
            ]
        },
        "files": {
            "items": [
                {
                    "id": "guide.txt",
                    "name": "guide.txt",
                    "file_id": "upload-file-1",
                    "is_missing": False,
                    "size": None,
                    "hash": None,
                    "mime_type": None,
                }
            ]
        },
        "env_keys": [],
        "note": "Use the guide.",
    }


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_manifest_preserves_missing_config_assets_and_download_rejects_them(sqlite_session: Session) -> None:
    soul = _soul(
        config_skills=[{"name": "alpha", "file_id": "", "is_missing": True}],
        config_files=[{"name": "guide.txt", "file_kind": "upload_file", "file_id": "", "is_missing": True}],
    )
    _persist_target(sqlite_session, _draft(soul=soul))
    service = _service(sqlite_session)
    target = service.resolve_target(
        tenant_id=TENANT,
        agent_id=AGENT,
        config_version_id=DRAFT,
        config_version_kind=AgentConfigVersionKind.DRAFT,
        user_id=USER,
    )

    with patch(f"{MODULE}.SkillManagementService") as skill_management_service:
        skill_management_service.return_value.list_runtime_agent_skills.return_value = []
        manifest = service._manifest_for_target(target)

    assert manifest["skills"]["items"][0]["is_missing"] is True  # type: ignore[index]
    assert manifest["files"]["items"][0]["is_missing"] is True  # type: ignore[index]
    with pytest.raises(AgentConfigServiceError) as skill_error:
        service.request_download(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id=DRAFT,
            config_version_kind=AgentConfigVersionKind.DRAFT,
            kind="skill",
            name="alpha",
            user_id=USER,
        )
    with pytest.raises(AgentConfigServiceError) as file_error:
        service.request_download(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id=DRAFT,
            config_version_kind=AgentConfigVersionKind.DRAFT,
            kind="file",
            name="guide.txt",
            user_id=USER,
        )

    assert (skill_error.value.code, skill_error.value.status_code) == ("config_skill_missing", 409)
    assert (file_error.value.code, file_error.value.status_code) == ("config_file_missing", 409)


def test_config_asset_refs_require_file_id_unless_marked_missing() -> None:
    assert AgentFileRefConfig().file_id is None
    assert (
        AgentConfigFileRefConfig(
            name="guide.txt",
            file_kind="upload_file",
            is_missing=True,
        ).file_id
        == ""
    )
    with pytest.raises(ValueError, match="file_id is required"):
        AgentConfigSkillRefConfig(name="alpha")
    with pytest.raises(ValueError, match="must not retain"):
        AgentConfigFileRefConfig(
            name="guide.txt",
            file_kind="upload_file",
            file_id="workspace-file-id",
            is_missing=True,
        )


def test_manifest_appends_published_workspace_skills() -> None:
    target = _target(
        kind=AgentConfigVersionKind.DRAFT,
        writable=False,
        soul=_soul(
            config_skills=[AgentConfigSkillRefConfig(name="alpha", description="Alpha skill", file_id="tool-file-1")]
        ),
    )

    with patch(f"{MODULE}.SkillManagementService") as skill_management_service:
        skill_management_service.return_value.list_runtime_agent_skills.return_value = [
            {
                "id": "workspace-skill-id",
                "name": "beta",
                "file_id": "tool-file-2",
                "description": "Beta workspace skill",
                "size": 123,
                "hash": "sha256:beta",
                "mime_type": "application/zip",
            },
            {
                "id": "duplicate",
                "name": "alpha",
                "file_id": "tool-file-ignored",
                "description": "Duplicate workspace skill",
                "size": 456,
                "hash": "sha256:ignored",
                "mime_type": "application/zip",
            },
        ]
        manifest = AgentConfigService._manifest_for_target(target)

    assert [item["name"] for item in manifest["skills"]["items"]] == ["alpha", "beta"]
    assert manifest["skills"]["items"][1]["file_id"] == "tool-file-2"


def test_list_skills_excludes_workspace_skill_bindings(sqlite_session: Session) -> None:
    target = _target(
        kind=AgentConfigVersionKind.DRAFT,
        writable=False,
        soul=_soul(
            config_skills=[AgentConfigSkillRefConfig(name="alpha", description="Alpha skill", file_id="tool-file-1")]
        ),
    )

    service = _service(sqlite_session)
    with (
        patch.object(service, "resolve_target", return_value=target),
        patch(f"{MODULE}.SkillManagementService") as skill_management_service,
    ):
        skill_management_service.return_value.list_runtime_agent_skills.return_value = [
            {
                "id": "workspace-skill-id",
                "name": "beta",
                "file_id": "tool-file-2",
                "description": "Beta workspace skill",
                "size": 123,
                "hash": "sha256:beta",
                "mime_type": "application/zip",
            }
        ]
        result = service.list_skills(
            tenant_id=target.tenant_id,
            agent_id=target.agent_id,
            config_version_id=target.version_id,
            config_version_kind=target.kind,
            user_id=None,
        )

    assert [item["name"] for item in result["items"]] == ["alpha"]
    skill_management_service.return_value.list_runtime_agent_skills.assert_not_called()


@pytest.mark.parametrize("case", ["tool-file", "upload-file", "foreign-tool-file"])
def test_preview_file_releases_transaction_before_storage(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], tmp_path: Path, case: str
) -> None:
    """Read the selected workspace asset outside its transaction and reject foreign metadata."""
    is_tool_file = case != "upload-file"
    is_foreign = case == "foreign-tool-file"
    name = "report.txt"
    key = f"config/{name}"
    payload = b"Preview this report\n"
    if is_tool_file:
        tool_file = ToolFile(
            tenant_id=OTHER_TENANT if is_foreign else TENANT,
            user_id=END_USER,
            conversation_id=None,
            file_key=key,
            mimetype="text/plain",
            name=name,
            size=len(payload),
        )
        tool_file.id = TOOL_FILE
        sqlite_session.add(tool_file)
    if not is_tool_file or is_foreign:
        # A same-ID local UploadFile cannot substitute for the selected foreign ToolFile.
        upload_file = make_upload_file(
            file_id=TOOL_FILE, tenant_id=TENANT, created_by=USER, key=key, name=name, size=len(payload)
        )
        sqlite_session.add(upload_file)
    file_ref = AgentConfigFileRefConfig(
        name=name, file_kind="tool_file" if is_tool_file else "upload_file", file_id=TOOL_FILE, size=len(payload)
    )
    _persist_target(sqlite_session, _draft(soul=AgentSoulConfig(config_files=[file_ref])))

    preview_file = partial(
        _service_for_sessions(sqlite_session_factory).preview_file,
        tenant_id=TENANT,
        agent_id=AGENT,
        config_version_id=DRAFT,
        config_version_kind=AgentConfigVersionKind.DRAFT,
        name=name,
        user_id=USER,
    )
    with _observe_config_storage_reads(tmp_path, sqlite_session_factory) as (local_storage, read_transactions):
        local_storage.save(key, payload)
        if is_foreign:
            with pytest.raises(AgentConfigServiceError) as caught:
                preview_file()
            assert caught.value.status_code == 404
            assert caught.value.code == "config_file_not_found"
            assert read_transactions == []
        else:
            assert preview_file() == {
                "name": name,
                "size": len(payload),
                "truncated": False,
                "binary": False,
                "text": payload.decode(),
            }
            assert read_transactions == [False]


def test_preview_skill_file_returns_text_preview(sqlite_session: Session) -> None:
    service = _service(sqlite_session)
    target = _target(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        writable=True,
        soul=_soul(config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id="tool-file-1")]),
    )
    archive_bytes = _zip_bytes(
        {
            "SKILL.md": b"# Alpha\n",
            "references/guide.md": b"hello world",
        }
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch.object(service, "_load_tool_file_bytes", return_value=(archive_bytes, "application/zip")),
    ):
        preview = service.preview_skill_file(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id="build-draft-1",
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            name="alpha",
            path="references/guide.md",
            user_id=USER,
        )

    assert preview == {
        "path": "references/guide.md",
        "size": 11,
        "truncated": False,
        "binary": False,
        "text": "hello world",
    }


def test_preview_skill_file_marks_binary_and_truncated_payloads(sqlite_session: Session) -> None:
    service = _service(sqlite_session)
    target = _target(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        writable=True,
        soul=_soul(config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id="tool-file-1")]),
    )
    archive_bytes = _zip_bytes(
        {
            "SKILL.md": b"# Alpha\n",
            "bin/data.bin": b"\x00" + (b"x" * (AgentConfigService.PREVIEW_MAX_BYTES + 10)),
        }
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch.object(service, "_load_tool_file_bytes", return_value=(archive_bytes, "application/zip")),
    ):
        preview = service.preview_skill_file(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id="build-draft-1",
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            name="alpha",
            path="bin/data.bin",
            user_id=USER,
        )

    assert preview == {
        "path": "bin/data.bin",
        "size": AgentConfigService.PREVIEW_MAX_BYTES + 11,
        "truncated": True,
        "binary": True,
        "text": None,
    }


def test_resolve_skill_file_member_path_requires_existing_member(sqlite_session: Session) -> None:
    service = _service(sqlite_session)
    target = _target(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        writable=True,
        soul=_soul(config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id="tool-file-1")]),
    )
    archive_bytes = _zip_bytes(
        {
            "SKILL.md": b"# Alpha\n",
            "references/guide.md": b"hello world",
        }
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch.object(service, "_load_tool_file_bytes", return_value=(archive_bytes, "application/zip")),
    ):
        assert (
            service.resolve_skill_file_member_path(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                name="alpha",
                path="references/guide.md",
                user_id=USER,
            )
            == "references/guide.md"
        )

        with pytest.raises(AgentConfigServiceError, match="config skill file not found") as exc_info:
            service.resolve_skill_file_member_path(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                name="alpha",
                path="references/missing.md",
                user_id=USER,
            )

    assert exc_info.value.code == "config_skill_file_not_found"
    assert exc_info.value.status_code == 404


def test_download_url_helpers_bind_shared_download_request_to_console_origin(
    sqlite_session: Session,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(FILES_URL="https://example.com")
    service = _service(sqlite_session)

    with (
        patch.object(
            service,
            "request_download",
            side_effect=[
                ConfigDownloadRequest("alpha.zip", "application/zip", 10, "/files/alpha.zip?sign=1"),
                ConfigDownloadRequest("guide.txt", "text/plain", 20, "/files/guide.txt?sign=2"),
            ],
        ),
    ):
        assert (
            service.download_skill_url(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                name="alpha",
                user_id=USER,
            )
            == "https://example.com/files/alpha.zip?sign=1"
        )
        assert (
            service.download_file_url(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                name="guide.txt",
                user_id=USER,
            )
            == "https://example.com/files/guide.txt?sign=2"
        )


def _persist_upload(session: Session, *, file_id: str, name: str, tenant_id: str = TENANT) -> UploadFile:
    upload = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"uploads/{file_id}",
        name=name,
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=END_USER,
        created_at=datetime(2025, 1, 1),
        used=False,
        hash=f"sha256:{file_id}",
    )
    upload.id = file_id
    session.add(upload)
    session.commit()
    return upload


@pytest.mark.parametrize("build_draft", [False, True])
def test_push_files_for_console_merges_batch_atomically_with_last_same_name_winning(
    sqlite_session: Session, build_draft: bool
) -> None:
    original = _soul(
        prompt={"system_prompt": "Keep these instructions"},
        config_note="Keep note",
        env={"variables": [{"name": "TOKEN", "value": "keep"}]},
        config_files=[AgentConfigFileRefConfig(name="keep.txt", file_kind="upload_file", file_id="kept")],
    )
    draft = _draft(
        soul=original,
        draft_type=AgentConfigDraftType.DEBUG_BUILD if build_draft else AgentConfigDraftType.DRAFT,
        account_id=USER if build_draft else None,
    )
    _persist_target(sqlite_session, draft)
    _persist_upload(sqlite_session, file_id=UPLOAD_FILE, name="same.txt")
    _persist_upload(sqlite_session, file_id=TOOL_FILE, name="new.txt")
    _persist_upload(sqlite_session, file_id=SKILL_FILE, name="same.txt")

    response = _service(sqlite_session).push_files_for_console(
        tenant_id=TENANT,
        agent_id=AGENT,
        user_id=USER,
        config_version_id=DRAFT,
        config_version_kind=AgentConfigVersionKind.BUILD_DRAFT if build_draft else AgentConfigVersionKind.DRAFT,
        upload_file_ids=[UPLOAD_FILE, TOOL_FILE, SKILL_FILE],
    )

    assert response == {
        "files": [
            {
                "id": name,
                "name": name,
                "file_id": file_id,
                "is_missing": False,
                "size": 7,
                "hash": f"sha256:{file_id}",
                "mime_type": "text/plain",
            }
            for name, file_id in [("same.txt", SKILL_FILE), ("new.txt", TOOL_FILE)]
        ],
        "config_version": {"id": DRAFT, "kind": "build_draft" if build_draft else "draft", "writable": True},
    }
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    expected = original.model_copy(deep=True)
    expected.config_files += [
        AgentConfigFileRefConfig(
            name=name,
            file_kind="upload_file",
            file_id=file_id,
            size=7,
            hash=f"sha256:{file_id}",
            mime_type="text/plain",
        )
        for name, file_id in [("same.txt", SKILL_FILE), ("new.txt", TOOL_FILE)]
    ]
    assert persisted.config_snapshot == expected


@pytest.mark.parametrize("invalid_source", ["missing", "other_tenant", "invalid_name"])
def test_push_files_for_console_does_not_commit_any_file_when_batch_validation_fails(
    sqlite_session: Session, invalid_source: str
) -> None:
    original = _soul(config_note="Unchanged")
    _persist_target(sqlite_session, _draft(soul=original))
    _persist_upload(sqlite_session, file_id=UPLOAD_FILE, name="valid.txt")
    if invalid_source != "missing":
        _persist_upload(
            sqlite_session,
            file_id=TOOL_FILE,
            name="../invalid.txt" if invalid_source == "invalid_name" else "foreign.txt",
            tenant_id=OTHER_TENANT if invalid_source == "other_tenant" else TENANT,
        )

    with pytest.raises((AgentConfigServiceError, ValueError)):
        _service(sqlite_session).push_files_for_console(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=DRAFT,
            config_version_kind=AgentConfigVersionKind.DRAFT,
            upload_file_ids=[UPLOAD_FILE, TOOL_FILE],
        )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot == original


def test_push_files_for_console_rejects_published_snapshots_without_mutation(sqlite_session: Session) -> None:
    _persist_target(sqlite_session, _snapshot())
    _persist_upload(sqlite_session, file_id=UPLOAD_FILE, name="valid.txt")
    with pytest.raises(AgentConfigServiceError, match="editable drafts"):
        _service(sqlite_session).push_files_for_console(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=SNAPSHOT,
            config_version_kind=AgentConfigVersionKind.SNAPSHOT,
            upload_file_ids=[UPLOAD_FILE],
        )
    sqlite_session.expire_all()
    snapshot = sqlite_session.get(AgentConfigSnapshot, SNAPSHOT)
    assert snapshot is not None
    assert snapshot.config_snapshot.config_files == []


def test_update_note_rolls_back_when_database_rejects_draft_write(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """Surface a rejected SQL UPDATE and preserve the committed Build draft in a fresh session."""
    original = _soul(config_note="Original note")
    _persist_target(
        sqlite_session,
        _draft(version_id=BUILD_DRAFT, draft_type=AgentConfigDraftType.DEBUG_BUILD, account_id=USER, soul=original),
    )
    sqlite_session.execute(
        text(
            "CREATE TRIGGER reject_config_update BEFORE UPDATE ON agent_config_drafts "
            "BEGIN SELECT RAISE(ABORT, 'test rejects config update'); END"
        )
    )
    sqlite_session.commit()

    with pytest.raises(IntegrityError, match="test rejects config update"):
        _service_for_sessions(sqlite_session_factory).update_note(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=BUILD_DRAFT,
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            note="Failed note",
        )

    with sqlite_session_factory() as session:
        assert session.get_one(AgentConfigDraft, BUILD_DRAFT).config_snapshot == original


@pytest.mark.parametrize("dirty_cached_draft", [False, True], ids=["cached", "dirty-cached"])
def test_push_files_for_console_locks_parent_then_draft_and_refreshes_cached_snapshot(
    sqlite_session: Session,
    dirty_cached_draft: bool,
) -> None:
    _persist_target(sqlite_session, _draft())
    _persist_upload(sqlite_session, file_id=UPLOAD_FILE, name="new.txt")
    factory = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    with factory() as binding_session:
        cached = binding_session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.id == DRAFT))
        assert cached is not None
        if dirty_cached_draft:
            pending_edit = cached.config_snapshot.model_copy(deep=True)
            pending_edit.prompt.system_prompt = "Stale local prompt"
            cached.config_snapshot = pending_edit
        with factory() as concurrent_session:
            concurrent = concurrent_session.get(AgentConfigDraft, DRAFT)
            assert concurrent is not None
            concurrent.config_snapshot = _soul(
                config_note="Concurrent edit",
                config_files=[AgentConfigFileRefConfig(name="keep.txt", file_kind="upload_file", file_id="kept")],
            )
            concurrent_session.commit()
        assert cached.config_snapshot.config_note == ""
        locked_queries: list[str] = []

        def record_lock(state: ORMExecuteState) -> None:
            if not isinstance(state.statement, Select):
                return
            sql = str(state.statement.compile(dialect=postgresql.dialect()))
            if "FOR UPDATE" in sql:
                locked_queries.append(sql)

        event.listen(binding_session, "do_orm_execute", record_lock)
        service = _service_for_sessions(factory, write_session=binding_session)
        service.push_files_for_console(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=DRAFT,
            config_version_kind=AgentConfigVersionKind.DRAFT,
            upload_file_ids=[UPLOAD_FILE],
        )

    assert len(locked_queries) == 2
    assert "FROM agents" in locked_queries[0]
    assert "FROM agent_config_drafts" in locked_queries[1]
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_note == "Concurrent edit"
    assert [ref.name for ref in persisted.config_snapshot.config_files] == ["keep.txt", "new.txt"]
