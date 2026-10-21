"""SQLAlchemy owner for durable upload-file references."""

import base64
import json
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import batched
from typing import Any
from uuid import uuid4

from sqlalchemy import String, and_, cast, delete, event, exists, insert, or_, select, update
from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.engine import Connection
from sqlalchemy.orm import InstrumentedAttribute, Mapper, Session, sessionmaker
from sqlalchemy.sql.elements import ColumnElement

from core.db.session_factory import session_factory as default_session_factory
from core.rag.extractor.entity.extract_setting import UploadFileExtractionInput
from core.workflow.file_reference import build_file_reference
from graphon.file import FileTransferMethod
from libs.markdown_images import extract_upload_file_ids_from_markdown, resolve_upload_file_id_from_preview_source
from libs.uuid_utils import uuidv7
from models.account import Account, Tenant
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigSnapshot,
    AgentConfigToolFileReference,
    AgentConfigUploadFileReference,
    AgentIconType,
)
from models.agent_config_entities import AgentConfigFileRefConfig, AgentConfigSkillRefConfig, AgentSoulConfig
from models.dataset import (
    Dataset,
    Document,
    DocumentSegment,
    PipelineCustomizedTemplate,
    SegmentAttachmentBinding,
)
from models.enums import CreatorUserRole, DataSourceType, IndexingStatus, SegmentStatus
from models.human_input import HumanInputForm, HumanInputFormUploadFile
from models.model import (
    App,
    Conversation,
    IconType,
    KnowledgeUploadFileReference,
    Message,
    MessageFile,
    Site,
    UploadFile,
)
from models.snippet import CustomizedSnippet
from models.tools import MCPToolProvider, ToolFile
from models.utils.file_input_compat import (
    resolve_file_record_id,
    resolve_upload_file_ids_from_serialized_file_value,
)
from models.workflow import (
    Workflow,
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowDraftVariableUploadFileReference,
    WorkflowNodeExecutionOffload,
)
from services.knowledge.indexing.cleanup import (
    DocumentCleanupManifest,
    SegmentAttachmentCleanup,
    UploadFileCleanup,
    UploadFilePendingDeletionError,
)
from services.knowledge.resource_scope import DatasetRef

DOCUMENT_SOURCE_REFERENCE = "document_source"
SEGMENT_IMAGE_REFERENCE = "segment_image"
AGENT_CONFIG_DRAFT_REFERENCE = "draft"
AGENT_CONFIG_SNAPSHOT_REFERENCE = "snapshot"
_REFERENCE_SCAN_BATCH_SIZE = 250
_preview_created_upload_files: ContextVar[tuple[str, dict[str, UploadFileCleanup]] | None] = ContextVar(
    "preview_created_upload_files",
    default=None,
)
_agent_config_created_tool_files: ContextVar[tuple[str, dict[str, "AgentConfigToolFileCleanup"]] | None]
_ICON_CLEANUP_CANDIDATES_ATTRIBUTE = "_upload_file_icon_cleanup_candidates"
_AGENT_CONFIG_CLEANUP_CANDIDATES_ATTRIBUTE = "_agent_config_upload_file_cleanup_candidates"
_AGENT_CONFIG_TOOL_CLEANUP_CANDIDATES_ATTRIBUTE = "_agent_config_tool_file_cleanup_candidates"
_AGENT_CONFIG_TOOL_ADOPTION_ATTRIBUTE = "_agent_config_tool_file_adoption"
_KNOWLEDGE_REFERENCE_MUTATION_ATTRIBUTE = "_knowledge_upload_file_reference_mutation"


@dataclass(frozen=True)
class _IconUploadReference:
    upload_file_id: str
    tenant_id: str | None = None
    account_id: str | None = None


@dataclass(frozen=True)
class _IconCleanupCandidate:
    tenant_id: str
    file: UploadFileCleanup


@dataclass(frozen=True)
class AgentConfigToolFileCleanup:
    id: str
    key: str


@dataclass(frozen=True)
class _KnowledgeReferenceMutation:
    tenant_id: str
    dataset_id: str
    document_id: str
    kind: str
    resource_id: str
    new_file_ids: tuple[str, ...]
    detached_files: tuple[UploadFileCleanup, ...]


class AgentConfigToolFilePendingDeletionError(RuntimeError):
    def __init__(self, file_ids: Sequence[str]) -> None:
        self.file_ids = tuple(file_ids)
        super().__init__("Agent config ToolFile is pending deletion")


_agent_config_created_tool_files = ContextVar(
    "agent_config_created_tool_files",
    default=None,
)


def _record_created_agent_config_tool_file(
    _mapper: Mapper[ToolFile],
    _connection: Connection,
    tool_file: ToolFile,
) -> None:
    tracked = _agent_config_created_tool_files.get()
    if tracked is None or tool_file.cleanup_started_at is None:
        return
    tenant_id, created = tracked
    if tool_file.tenant_id == tenant_id:
        created[tool_file.id] = AgentConfigToolFileCleanup(id=tool_file.id, key=tool_file.file_key)


@contextmanager
def track_created_agent_config_tool_files(*, tenant_id: str) -> Generator[dict[str, AgentConfigToolFileCleanup]]:
    """Prove which pending ToolFiles a single Agent config mutation created.

    Skill normalization persists its ToolFile in an independent transaction so
    a process exit cannot erase the storage key. Only rows observed through
    this insert listener may be adopted by the surrounding config transaction;
    caller-supplied ToolFile ids never enter the provenance set.
    """

    if not event.contains(ToolFile, "after_insert", _record_created_agent_config_tool_file):
        event.listen(ToolFile, "after_insert", _record_created_agent_config_tool_file)
    created: dict[str, AgentConfigToolFileCleanup] = {}
    token = _agent_config_created_tool_files.set((tenant_id, created))
    try:
        yield created
    finally:
        _agent_config_created_tool_files.reset(token)


def _created_agent_config_tool_file_ids(*, tenant_id: str) -> frozenset[str]:
    tracked = _agent_config_created_tool_files.get()
    if tracked is None or tracked[0] != tenant_id:
        return frozenset()
    return frozenset(tracked[1])


def create_pending_agent_config_skill_file(
    *,
    tenant_id: str,
    user_id: str,
    normalized_name: str,
    size: int,
    cleanup_started_at: datetime,
) -> AgentConfigToolFileCleanup:
    """Persist the exact key for an unadopted normalized Agent skill."""

    file_key = f"tools/{tenant_id}/{uuid4().hex}.zip"
    tool_file = ToolFile(
        user_id=user_id,
        tenant_id=tenant_id,
        conversation_id=None,
        file_key=file_key,
        mimetype="application/zip",
        name=f"{normalized_name}.zip",
        size=size,
        original_url=None,
        cleanup_started_at=cleanup_started_at,
    )
    with default_session_factory.create_session() as session:
        session.add(tool_file)
        session.commit()
        session.refresh(tool_file)
    return AgentConfigToolFileCleanup(id=tool_file.id, key=tool_file.file_key)


def _record_created_upload_file(_mapper: Mapper[UploadFile], _connection: Connection, upload_file: UploadFile) -> None:
    tracked = _preview_created_upload_files.get()
    if tracked is None:
        return
    tenant_id, created = tracked
    if upload_file.tenant_id == tenant_id:
        created[upload_file.id] = UploadFileCleanup(id=upload_file.id, key=upload_file.key)


@contextmanager
def track_created_upload_files(*, tenant_id: str) -> Generator[dict[str, UploadFileCleanup]]:
    """Record UploadFile rows inserted by the current extraction context.

    The mapper listener observes inserts from both the caller's Session and
    extractors that intentionally use their own bounded Session. Existing rows
    mentioned by preview Markdown are never added to this provenance set.
    """

    if not event.contains(UploadFile, "after_insert", _record_created_upload_file):
        event.listen(UploadFile, "after_insert", _record_created_upload_file)
    created: dict[str, UploadFileCleanup] = {}
    token = _preview_created_upload_files.set((tenant_id, created))
    try:
        yield created
    finally:
        _preview_created_upload_files.reset(token)


def _guard_reusable_upload_file(
    connection: Connection,
    *,
    tenant_id: str,
    upload_file_id: str,
    owner_name: str,
) -> None:
    upload = connection.execute(
        select(UploadFile.id, UploadFile.knowledge_cleanup_started_at)
        .where(UploadFile.id == upload_file_id, UploadFile.tenant_id == tenant_id)
        .with_for_update()
    ).one_or_none()
    if upload is None:
        raise ValueError(f"local upload file does not belong to the {owner_name} tenant")
    if upload.knowledge_cleanup_started_at is not None:
        raise UploadFilePendingDeletionError((upload_file_id,))


def guard_local_message_file_upload_reference(
    _mapper: Mapper[MessageFile], connection: Connection, message_file: MessageFile
) -> None:
    """Fence reusable local uploads in the MessageFile writer transaction."""

    if message_file.transfer_method != FileTransferMethod.LOCAL_FILE:
        return
    upload_file_id = message_file.upload_file_id
    if upload_file_id is None:
        raise ValueError("local message files require an upload file")
    tenant_id = connection.scalar(
        select(App.tenant_id)
        .join(Message, Message.app_id == App.id)
        .where(Message.id == message_file.message_id)
        .limit(1)
    )
    if tenant_id is None:
        raise LookupError("message owner no longer exists")
    _guard_reusable_upload_file(
        connection,
        tenant_id=tenant_id,
        upload_file_id=upload_file_id,
        owner_name="message",
    )


def extract_app_icon_upload_file_id(icon_type: IconType | str | None, icon: str | None) -> str | None:
    """Resolve a storage-backed App icon from its persisted id or preview URL."""

    icon_type_value = icon_type.value if isinstance(icon_type, IconType) else icon_type
    if icon_type_value != IconType.IMAGE.value or not icon:
        return None
    return resolve_upload_file_id_from_preview_source(icon) or icon


def guard_app_icon_upload_reference(_mapper: Mapper[App], connection: Connection, app: App) -> None:
    """Fence an App icon change and retain the detached prior upload."""

    app.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    old_reference: _IconUploadReference | None = None
    state = sqlalchemy_inspect(app)
    if state.persistent:
        persisted = connection.execute(
            select(App.tenant_id, App.icon_type, App.icon).where(App.id == app.id).limit(1)
        ).one_or_none()
        if persisted is not None:
            old_file_id = extract_app_icon_upload_file_id(persisted.icon_type, persisted.icon)
            if old_file_id is not None:
                old_reference = _IconUploadReference(old_file_id, tenant_id=persisted.tenant_id)
    new_file_id = extract_app_icon_upload_file_id(app.icon_type, app.icon)
    new_reference = _IconUploadReference(new_file_id, tenant_id=app.tenant_id) if new_file_id is not None else None
    if state.persistent and old_reference == new_reference:
        return
    _prepare_icon_upload_change(
        connection,
        target=app,
        owner_name="app",
        old_reference=old_reference,
        new_reference=new_reference,
    )


def guard_site_icon_upload_reference(_mapper: Mapper[Site], connection: Connection, site: Site) -> None:
    """Fence a Site icon change through its App tenant owner."""

    site.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    old_reference: _IconUploadReference | None = None
    owner_tenants: dict[str, str] = {}
    state = sqlalchemy_inspect(site)
    persisted = None
    if state.persistent:
        persisted = connection.execute(
            select(Site.app_id, Site.icon_type, Site.icon).where(Site.id == site.id).limit(1)
        ).one_or_none()
        if persisted is not None:
            old_tenant_id = connection.scalar(select(App.tenant_id).where(App.id == persisted.app_id).limit(1))
            if old_tenant_id is not None:
                owner_tenants[persisted.app_id] = old_tenant_id
                old_file_id = extract_app_icon_upload_file_id(persisted.icon_type, persisted.icon)
                if old_file_id is not None:
                    old_reference = _IconUploadReference(old_file_id, tenant_id=old_tenant_id)
    new_tenant_id = connection.scalar(select(App.tenant_id).where(App.id == site.app_id).limit(1))
    if new_tenant_id is None:
        raise LookupError("site owner no longer exists")
    owner_tenants[site.app_id] = new_tenant_id
    new_file_id = extract_app_icon_upload_file_id(site.icon_type, site.icon)
    new_reference = _IconUploadReference(new_file_id, tenant_id=new_tenant_id) if new_file_id is not None else None
    if (
        state.persistent
        and old_reference == new_reference
        and persisted is not None
        and persisted.app_id == site.app_id
    ):
        return
    _prepare_icon_upload_change(
        connection,
        target=site,
        owner_name="site",
        old_reference=old_reference,
        new_reference=new_reference,
    )
    locked_owner_tenants = {
        row.id: row.tenant_id
        for row in connection.execute(
            select(App.id, App.tenant_id)
            .where(App.id.in_(tuple(sorted(owner_tenants))))
            .order_by(App.id)
            .with_for_update(nowait=True)
        ).all()
    }
    if locked_owner_tenants != owner_tenants:
        raise LookupError("site owner changed while its icon reference was being fenced")


def extract_account_avatar_upload_file_id(avatar: str | None) -> str | None:
    """Return the local upload id stored by an account avatar reference."""

    if not avatar or avatar.startswith(("http://", "https://")):
        return None
    return avatar


def extract_tenant_logo_upload_file_id(custom_config: str | None) -> str | None:
    """Return the local upload id stored in a workspace custom configuration."""

    if not custom_config:
        return None
    try:
        config = json.loads(custom_config)
    except (TypeError, ValueError):
        return None
    if not isinstance(config, dict):
        return None
    logo = config.get("replace_webapp_logo")
    if not isinstance(logo, str) or not logo:
        return None
    return resolve_upload_file_id_from_preview_source(logo) or logo


def extract_icon_info_upload_file_id(icon_info: object) -> str | None:
    """Resolve the upload id from the shared persisted icon-info shape."""

    if not isinstance(icon_info, Mapping) or icon_info.get("icon_type") != IconType.IMAGE.value:
        return None
    icon = icon_info.get("icon")
    if not isinstance(icon, str) or not icon:
        return None
    return resolve_upload_file_id_from_preview_source(icon) or icon


def extract_mcp_icon_upload_file_id(icon: object) -> str | None:
    """Resolve MCP image ids while excluding the provider's JSON emoji shape."""

    if not isinstance(icon, str) or not icon:
        return None
    try:
        if isinstance(json.loads(icon), dict):
            return None
    except (TypeError, ValueError):
        pass
    return resolve_upload_file_id_from_preview_source(icon) or icon


def extract_agent_icon_upload_file_id(icon_type: AgentIconType | str | None, icon: str | None) -> str | None:
    icon_type_value = icon_type.value if isinstance(icon_type, AgentIconType) else icon_type
    if icon_type_value != AgentIconType.IMAGE.value or not icon:
        return None
    return resolve_upload_file_id_from_preview_source(icon) or icon


def extract_agent_config_upload_file_ids(config_snapshot: object) -> tuple[str, ...]:
    """Return reusable UploadFile ids embedded in an Agent Soul config."""

    if isinstance(config_snapshot, str):
        try:
            config_snapshot = json.loads(config_snapshot)
        except (TypeError, ValueError):
            return ()
    if isinstance(config_snapshot, AgentSoulConfig):
        config_files = config_snapshot.config_files
    elif isinstance(config_snapshot, Mapping):
        config_files = config_snapshot.get("config_files")
    else:
        return ()
    if not isinstance(config_files, Sequence) or isinstance(config_files, (str, bytes)):
        return ()
    file_ids: list[str] = []
    for item in config_files:
        if isinstance(item, Mapping):
            file_kind = item.get("file_kind")
            file_id = item.get("file_id")
            is_missing = item.get("is_missing", False)
        elif isinstance(item, AgentConfigFileRefConfig):
            file_kind = item.file_kind
            file_id = item.file_id
            is_missing = item.is_missing
        else:
            continue
        if file_kind == "upload_file" and is_missing is not True and isinstance(file_id, str) and file_id:
            file_ids.append(file_id)
    return _unique(file_ids)


def extract_agent_config_tool_file_ids(config_snapshot: object) -> tuple[str, ...]:
    """Return ToolFile ids embedded in Agent Soul config files and skills."""

    if isinstance(config_snapshot, str):
        try:
            config_snapshot = json.loads(config_snapshot)
        except (TypeError, ValueError):
            return ()
    if isinstance(config_snapshot, AgentSoulConfig):
        config_files = config_snapshot.config_files
        config_skills = config_snapshot.config_skills
    elif isinstance(config_snapshot, Mapping):
        config_files = config_snapshot.get("config_files")
        config_skills = config_snapshot.get("config_skills")
    else:
        return ()
    file_ids: list[str] = []
    if isinstance(config_files, Sequence) and not isinstance(config_files, (str, bytes)):
        for item in config_files:
            if isinstance(item, Mapping):
                file_kind = item.get("file_kind")
                file_id = item.get("file_id")
                is_missing = item.get("is_missing", False)
            elif isinstance(item, AgentConfigFileRefConfig):
                file_kind = item.file_kind
                file_id = item.file_id
                is_missing = item.is_missing
            else:
                continue
            if file_kind == "tool_file" and is_missing is not True and isinstance(file_id, str) and file_id:
                file_ids.append(file_id)
    if isinstance(config_skills, Sequence) and not isinstance(config_skills, (str, bytes)):
        for item in config_skills:
            if isinstance(item, Mapping):
                file_id = item.get("file_id")
                is_missing = item.get("is_missing", False)
            elif isinstance(item, AgentConfigSkillRefConfig):
                file_id = item.file_id
                is_missing = item.is_missing
            else:
                continue
            if is_missing is not True and isinstance(file_id, str) and file_id:
                file_ids.append(file_id)
    return _unique(file_ids)


def _agent_config_owner_kind(config: AgentConfigDraft | AgentConfigSnapshot) -> str:
    if isinstance(config, AgentConfigDraft):
        return AGENT_CONFIG_DRAFT_REFERENCE
    if isinstance(config, AgentConfigSnapshot):
        return AGENT_CONFIG_SNAPSHOT_REFERENCE
    raise TypeError(f"unsupported Agent config owner: {type(config).__name__}")


def _persisted_agent_config_snapshot(
    connection: Connection,
    config: AgentConfigDraft | AgentConfigSnapshot,
) -> object | None:
    model = AgentConfigDraft if isinstance(config, AgentConfigDraft) else AgentConfigSnapshot
    return connection.scalar(select(model.config_snapshot).where(model.id == config.id).limit(1))


def guard_agent_config_upload_references(
    _mapper: Mapper[AgentConfigDraft] | Mapper[AgentConfigSnapshot],
    connection: Connection,
    config: AgentConfigDraft | AgentConfigSnapshot,
) -> None:
    """Fence Agent Soul file writes and retain detached cleanup candidates."""

    config.__dict__.pop(_AGENT_CONFIG_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    config.__dict__.pop(_AGENT_CONFIG_TOOL_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    config.__dict__.pop(_AGENT_CONFIG_TOOL_ADOPTION_ATTRIBUTE, None)
    state = sqlalchemy_inspect(config)
    persisted_snapshot = _persisted_agent_config_snapshot(connection, config) if state.persistent else None
    old_upload_ids = extract_agent_config_upload_file_ids(persisted_snapshot)
    new_upload_ids = extract_agent_config_upload_file_ids(config.config_snapshot)
    upload_candidate_ids = tuple(sorted(set(old_upload_ids) | set(new_upload_ids)))
    old_tool_ids = extract_agent_config_tool_file_ids(persisted_snapshot)
    new_tool_ids = extract_agent_config_tool_file_ids(config.config_snapshot)
    tool_candidate_ids = tuple(sorted(set(old_tool_ids) | set(new_tool_ids)))
    if not upload_candidate_ids and not tool_candidate_ids:
        return
    uploads = (
        connection.execute(
            select(
                UploadFile.id,
                UploadFile.tenant_id,
                UploadFile.key,
                UploadFile.knowledge_cleanup_started_at,
            )
            .where(UploadFile.id.in_(upload_candidate_ids))
            .order_by(UploadFile.id)
            .with_for_update(of=UploadFile)
        ).all()
        if upload_candidate_ids
        else ()
    )
    uploads_by_id = {row.id: row for row in uploads}
    invalid_new_ids = tuple(
        file_id
        for file_id in new_upload_ids
        if (row := uploads_by_id.get(file_id)) is None or row.tenant_id != config.tenant_id
    )
    if invalid_new_ids:
        raise ValueError("local upload file does not belong to the Agent config tenant")
    pending_ids = tuple(
        file_id for file_id in new_upload_ids if uploads_by_id[file_id].knowledge_cleanup_started_at is not None
    )
    if pending_ids:
        raise UploadFilePendingDeletionError(pending_ids)

    tool_files = (
        connection.execute(
            select(ToolFile.id, ToolFile.tenant_id, ToolFile.file_key, ToolFile.cleanup_started_at)
            .where(ToolFile.id.in_(tool_candidate_ids))
            .order_by(ToolFile.id)
            .with_for_update(of=ToolFile)
        ).all()
        if tool_candidate_ids
        else ()
    )
    tool_files_by_id = {row.id: row for row in tool_files}
    adoption_checked_at = datetime.now(UTC).replace(tzinfo=None)
    invalid_new_tool_ids = tuple(
        file_id
        for file_id in new_tool_ids
        if (row := tool_files_by_id.get(file_id)) is None or row.tenant_id != config.tenant_id
    )
    if invalid_new_tool_ids:
        raise ValueError("ToolFile does not belong to the Agent config tenant")
    created_tool_ids = _created_agent_config_tool_file_ids(tenant_id=config.tenant_id)
    pending_tool_ids = tuple(
        file_id
        for file_id in new_tool_ids
        if (
            (cleanup_started_at := tool_files_by_id[file_id].cleanup_started_at) is not None
            and file_id not in created_tool_ids
        )
        or (file_id in created_tool_ids and (cleanup_started_at is None or cleanup_started_at <= adoption_checked_at))
    )
    if pending_tool_ids:
        raise AgentConfigToolFilePendingDeletionError(pending_tool_ids)
    adoptable_tool_ids = tuple(file_id for file_id in new_tool_ids if file_id in created_tool_ids)
    if adoptable_tool_ids:
        config.__dict__[_AGENT_CONFIG_TOOL_ADOPTION_ATTRIBUTE] = (adoption_checked_at, adoptable_tool_ids)

    owner_id = connection.scalar(
        select(Agent.id)
        .where(Agent.id == config.agent_id, Agent.tenant_id == config.tenant_id)
        .with_for_update(nowait=True)
        .limit(1)
    )
    if owner_id is None:
        raise LookupError("Agent config owner no longer exists")

    detached_ids = tuple(file_id for file_id in old_upload_ids if file_id not in set(new_upload_ids))
    candidates = tuple(
        _IconCleanupCandidate(
            tenant_id=config.tenant_id,
            file=UploadFileCleanup(id=file_id, key=uploads_by_id[file_id].key),
        )
        for file_id in detached_ids
        if file_id in uploads_by_id and uploads_by_id[file_id].tenant_id == config.tenant_id
    )
    if candidates:
        config.__dict__[_AGENT_CONFIG_CLEANUP_CANDIDATES_ATTRIBUTE] = candidates
    detached_tool_ids = tuple(file_id for file_id in old_tool_ids if file_id not in set(new_tool_ids))
    tool_candidates = tuple(
        AgentConfigToolFileCleanup(id=file_id, key=tool_files_by_id[file_id].file_key)
        for file_id in detached_tool_ids
        if file_id in tool_files_by_id and tool_files_by_id[file_id].tenant_id == config.tenant_id
    )
    if tool_candidates:
        config.__dict__[_AGENT_CONFIG_TOOL_CLEANUP_CANDIDATES_ATTRIBUTE] = tool_candidates


def prepare_agent_config_deletion(
    _mapper: Mapper[AgentConfigDraft] | Mapper[AgentConfigSnapshot],
    connection: Connection,
    config: AgentConfigDraft | AgentConfigSnapshot,
) -> None:
    persisted_snapshot = _persisted_agent_config_snapshot(connection, config)
    upload_file_ids = extract_agent_config_upload_file_ids(persisted_snapshot)
    tool_file_ids = extract_agent_config_tool_file_ids(persisted_snapshot)
    if not upload_file_ids and not tool_file_ids:
        return
    uploads = (
        connection.execute(
            select(UploadFile.id, UploadFile.tenant_id, UploadFile.key)
            .where(UploadFile.id.in_(upload_file_ids))
            .order_by(UploadFile.id)
            .with_for_update(of=UploadFile)
        ).all()
        if upload_file_ids
        else ()
    )
    tool_files = (
        connection.execute(
            select(ToolFile.id, ToolFile.tenant_id, ToolFile.file_key)
            .where(ToolFile.id.in_(tool_file_ids))
            .order_by(ToolFile.id)
            .with_for_update(of=ToolFile)
        ).all()
        if tool_file_ids
        else ()
    )
    owner_id = connection.scalar(
        select(Agent.id)
        .where(Agent.id == config.agent_id, Agent.tenant_id == config.tenant_id)
        .with_for_update(nowait=True)
        .limit(1)
    )
    if owner_id is None:
        raise LookupError("Agent config owner no longer exists")
    config.__dict__[_AGENT_CONFIG_CLEANUP_CANDIDATES_ATTRIBUTE] = tuple(
        _IconCleanupCandidate(
            tenant_id=config.tenant_id,
            file=UploadFileCleanup(id=row.id, key=row.key),
        )
        for row in uploads
        if row.tenant_id == config.tenant_id
    )
    config.__dict__[_AGENT_CONFIG_TOOL_CLEANUP_CANDIDATES_ATTRIBUTE] = tuple(
        AgentConfigToolFileCleanup(id=row.id, key=row.file_key)
        for row in tool_files
        if row.tenant_id == config.tenant_id
    )


def guard_agent_config_normalized_upload_reference(
    _mapper: Mapper[AgentConfigUploadFileReference],
    connection: Connection,
    reference: AgentConfigUploadFileReference,
) -> None:
    _guard_reusable_upload_file(
        connection,
        tenant_id=reference.tenant_id,
        upload_file_id=reference.upload_file_id,
        owner_name="Agent config reference",
    )


def guard_agent_config_normalized_tool_reference(
    _mapper: Mapper[AgentConfigToolFileReference],
    connection: Connection,
    reference: AgentConfigToolFileReference,
) -> None:
    row = connection.execute(
        select(ToolFile.tenant_id, ToolFile.cleanup_started_at)
        .where(ToolFile.id == reference.tool_file_id)
        .with_for_update(of=ToolFile)
        .limit(1)
    ).one_or_none()
    if row is None or row.tenant_id != reference.tenant_id:
        raise ValueError("ToolFile does not belong to the Agent config tenant")
    if row.cleanup_started_at is not None:
        raise AgentConfigToolFilePendingDeletionError((reference.tool_file_id,))
    if not _agent_config_owner_exists(
        connection,
        tenant_id=reference.tenant_id,
        owner_kind=reference.owner_kind,
        owner_id=reference.owner_id,
    ):
        raise LookupError("Agent config ToolFile reference owner no longer exists")


def _agent_config_owner_exists(
    connection: Connection,
    *,
    tenant_id: str,
    owner_kind: str,
    owner_id: str,
) -> bool:
    if owner_kind == AGENT_CONFIG_DRAFT_REFERENCE:
        statement = (
            select(AgentConfigDraft.id)
            .join(
                Agent,
                and_(
                    Agent.id == AgentConfigDraft.agent_id,
                    Agent.tenant_id == AgentConfigDraft.tenant_id,
                ),
            )
            .where(
                AgentConfigDraft.tenant_id == tenant_id,
                AgentConfigDraft.id == owner_id,
            )
        )
    elif owner_kind == AGENT_CONFIG_SNAPSHOT_REFERENCE:
        statement = (
            select(AgentConfigSnapshot.id)
            .join(
                Agent,
                and_(
                    Agent.id == AgentConfigSnapshot.agent_id,
                    Agent.tenant_id == AgentConfigSnapshot.tenant_id,
                ),
            )
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.id == owner_id,
            )
        )
    else:
        return False
    return connection.scalar(statement.limit(1)) is not None


def _valid_agent_config_tool_reference() -> ColumnElement[bool]:
    draft_exists = exists(
        select(AgentConfigDraft.id)
        .join(
            Agent,
            and_(
                Agent.id == AgentConfigDraft.agent_id,
                Agent.tenant_id == AgentConfigDraft.tenant_id,
            ),
        )
        .where(
            AgentConfigDraft.tenant_id == AgentConfigToolFileReference.tenant_id,
            AgentConfigDraft.id == AgentConfigToolFileReference.owner_id,
        )
    )
    snapshot_exists = exists(
        select(AgentConfigSnapshot.id)
        .join(
            Agent,
            and_(
                Agent.id == AgentConfigSnapshot.agent_id,
                Agent.tenant_id == AgentConfigSnapshot.tenant_id,
            ),
        )
        .where(
            AgentConfigSnapshot.tenant_id == AgentConfigToolFileReference.tenant_id,
            AgentConfigSnapshot.id == AgentConfigToolFileReference.owner_id,
        )
    )
    return or_(
        (AgentConfigToolFileReference.owner_kind == AGENT_CONFIG_DRAFT_REFERENCE) & draft_exists,
        (AgentConfigToolFileReference.owner_kind == AGENT_CONFIG_SNAPSHOT_REFERENCE) & snapshot_exists,
    )


def _remove_stale_agent_config_tool_references(
    connection: Connection | Session,
    *,
    tenant_id: str,
    file_ids: Sequence[str],
) -> None:
    if not file_ids:
        return
    connection.execute(
        delete(AgentConfigToolFileReference).where(
            AgentConfigToolFileReference.tenant_id == tenant_id,
            AgentConfigToolFileReference.tool_file_id.in_(file_ids),
            ~_valid_agent_config_tool_reference(),
        )
    )


def _serialized_agent_config_tool_file_references(
    connection: Connection | Session,
    *,
    tenant_id: str,
    candidate_ids: Sequence[str],
) -> set[str]:
    """Protect candidate-matching Agent JSON written by rolling old workers."""

    candidates = set(candidate_ids)
    referenced_ids: set[str] = set()
    for model in (AgentConfigDraft, AgentConfigSnapshot):
        configs = connection.scalars(
            select(model.config_snapshot)
            .join(
                Agent,
                and_(
                    Agent.id == model.agent_id,
                    Agent.tenant_id == model.tenant_id,
                ),
            )
            .where(
                model.tenant_id == tenant_id,
                Agent.tenant_id == tenant_id,
                _candidate_serialized_reference_predicate(cast(model.config_snapshot, String), candidate_ids),
            )
            .with_for_update(nowait=True)
        ).all()
        referenced_ids.update(
            file_id
            for config_snapshot in configs
            for file_id in extract_agent_config_tool_file_ids(config_snapshot)
            if file_id in candidates
        )
    return referenced_ids


def _find_orphan_agent_config_tool_files(
    connection: Connection | Session,
    *,
    tenant_id: str,
    files: Sequence[AgentConfigToolFileCleanup],
    excluding_conversation_app_id: str | None = None,
) -> tuple[AgentConfigToolFileCleanup, ...]:
    candidates = {file.id: file for file in files}
    if len(candidates) > _REFERENCE_SCAN_BATCH_SIZE:
        orphan_ids: set[str] = set()
        ordered_candidates = tuple(sorted(candidates.values(), key=lambda file: file.id))
        for candidate_batch in batched(ordered_candidates, _REFERENCE_SCAN_BATCH_SIZE, strict=False):
            orphan_ids.update(
                file.id
                for file in _find_orphan_agent_config_tool_files(
                    connection,
                    tenant_id=tenant_id,
                    files=candidate_batch,
                    excluding_conversation_app_id=excluding_conversation_app_id,
                )
            )
        return tuple(file for file_id, file in candidates.items() if file_id in orphan_ids)
    file_ids = tuple(candidates)
    if not file_ids:
        return ()
    referenced_ids = set(
        connection.scalars(
            select(AgentConfigToolFileReference.tool_file_id).where(
                AgentConfigToolFileReference.tenant_id == tenant_id,
                AgentConfigToolFileReference.tool_file_id.in_(file_ids),
                _valid_agent_config_tool_reference(),
            )
        ).all()
    )
    referenced_ids.update(
        _serialized_agent_config_tool_file_references(
            connection,
            tenant_id=tenant_id,
            candidate_ids=file_ids,
        )
    )
    conversation_owner = exists().where(Conversation.id == ToolFile.conversation_id)
    if excluding_conversation_app_id is not None:
        conversation_owner = conversation_owner.where(Conversation.app_id != excluding_conversation_app_id)
    conversation_owned_ids = set(
        connection.scalars(
            select(ToolFile.id).where(
                ToolFile.tenant_id == tenant_id,
                ToolFile.id.in_(file_ids),
                conversation_owner,
            )
        ).all()
    )
    return tuple(file for file in files if file.id not in referenced_ids and file.id not in conversation_owned_ids)


def claim_orphan_agent_config_tool_files(
    session: Session,
    *,
    tenant_id: str,
    files: Sequence[AgentConfigToolFileCleanup],
    excluding_conversation_app_id: str | None = None,
) -> tuple[AgentConfigToolFileCleanup, ...]:
    """Mark ToolFiles after their conversation/config owners are detached."""

    candidate_ids = tuple(sorted({file.id for file in files}))
    if not candidate_ids:
        return ()
    rows = session.execute(
        select(ToolFile.id, ToolFile.file_key)
        .where(ToolFile.tenant_id == tenant_id, ToolFile.id.in_(candidate_ids))
        .order_by(ToolFile.id)
        .with_for_update(of=ToolFile)
    ).all()
    locked_files = tuple(AgentConfigToolFileCleanup(id=row.id, key=row.file_key) for row in rows)
    _remove_stale_agent_config_tool_references(session, tenant_id=tenant_id, file_ids=candidate_ids)
    orphan_files = _find_orphan_agent_config_tool_files(
        session,
        tenant_id=tenant_id,
        files=locked_files,
        excluding_conversation_app_id=excluding_conversation_app_id,
    )
    orphan_ids = tuple(file.id for file in orphan_files)
    if orphan_ids:
        session.execute(
            update(ToolFile)
            .where(
                ToolFile.tenant_id == tenant_id,
                ToolFile.id.in_(orphan_ids),
                ToolFile.cleanup_started_at.is_(None),
            )
            .values(
                cleanup_started_at=datetime.now(UTC).replace(tzinfo=None),
                conversation_id=None,
            )
        )
    return orphan_files


def recheck_claimed_agent_config_tool_files(
    session: Session,
    *,
    tenant_id: str,
    files: Sequence[AgentConfigToolFileCleanup],
    excluding_conversation_app_id: str | None = None,
) -> tuple[AgentConfigToolFileCleanup, ...]:
    candidate_ids = tuple(sorted({file.id for file in files}))
    if not candidate_ids:
        return ()
    rows = session.execute(
        select(ToolFile.id, ToolFile.file_key)
        .where(
            ToolFile.tenant_id == tenant_id,
            ToolFile.id.in_(candidate_ids),
            ToolFile.cleanup_started_at.is_not(None),
        )
        .order_by(ToolFile.id)
        .with_for_update(of=ToolFile)
    ).all()
    locked_files = tuple(AgentConfigToolFileCleanup(id=row.id, key=row.file_key) for row in rows)
    _remove_stale_agent_config_tool_references(session, tenant_id=tenant_id, file_ids=candidate_ids)
    orphan_files = _find_orphan_agent_config_tool_files(
        session,
        tenant_id=tenant_id,
        files=locked_files,
        excluding_conversation_app_id=excluding_conversation_app_id,
    )
    orphan_ids = {file.id for file in orphan_files}
    restored_ids = tuple(file.id for file in locked_files if file.id not in orphan_ids)
    if restored_ids:
        session.execute(
            update(ToolFile)
            .where(ToolFile.tenant_id == tenant_id, ToolFile.id.in_(restored_ids))
            .values(cleanup_started_at=None)
        )
    return orphan_files


def delete_claimed_agent_config_tool_files(
    session: Session,
    *,
    tenant_id: str,
    files: Sequence[AgentConfigToolFileCleanup],
    excluding_conversation_app_id: str | None = None,
) -> tuple[str, ...]:
    orphan_files = recheck_claimed_agent_config_tool_files(
        session,
        tenant_id=tenant_id,
        files=files,
        excluding_conversation_app_id=excluding_conversation_app_id,
    )
    orphan_ids = tuple(file.id for file in orphan_files)
    if orphan_ids:
        session.execute(
            delete(ToolFile).where(
                ToolFile.tenant_id == tenant_id,
                ToolFile.id.in_(orphan_ids),
                ToolFile.cleanup_started_at.is_not(None),
            )
        )
    return orphan_ids


def find_claimed_agent_config_tool_files(
    session: Session,
    *,
    limit: int,
) -> tuple[tuple[str, AgentConfigToolFileCleanup], ...]:
    rows = session.execute(
        select(ToolFile.tenant_id, ToolFile.id, ToolFile.file_key)
        .where(
            ToolFile.cleanup_started_at.is_not(None),
            ToolFile.cleanup_started_at <= datetime.now(UTC).replace(tzinfo=None),
        )
        .order_by(ToolFile.cleanup_started_at, ToolFile.id)
        .limit(limit)
    ).all()
    return tuple((row.tenant_id, AgentConfigToolFileCleanup(id=row.id, key=row.file_key)) for row in rows)


def _claim_detached_agent_config_tool_files(
    connection: Connection,
    config: AgentConfigDraft | AgentConfigSnapshot,
) -> None:
    candidates = config.__dict__.pop(_AGENT_CONFIG_TOOL_CLEANUP_CANDIDATES_ATTRIBUTE, ())
    if not candidates:
        return
    candidate_ids = tuple(file.id for file in candidates)
    _remove_stale_agent_config_tool_references(connection, tenant_id=config.tenant_id, file_ids=candidate_ids)
    orphan_files = _find_orphan_agent_config_tool_files(
        connection,
        tenant_id=config.tenant_id,
        files=candidates,
    )
    orphan_ids = tuple(file.id for file in orphan_files)
    if orphan_ids:
        connection.execute(
            update(ToolFile)
            .where(
                ToolFile.tenant_id == config.tenant_id,
                ToolFile.id.in_(orphan_ids),
                ToolFile.cleanup_started_at.is_(None),
            )
            .values(
                cleanup_started_at=datetime.now(UTC).replace(tzinfo=None),
                conversation_id=None,
            )
        )


def sync_agent_config_upload_references(
    _mapper: Mapper[AgentConfigDraft] | Mapper[AgentConfigSnapshot],
    connection: Connection,
    config: AgentConfigDraft | AgentConfigSnapshot,
) -> None:
    """Replace normalized Agent Soul edges and claim detached files atomically."""

    owner_kind = _agent_config_owner_kind(config)
    connection.execute(
        delete(AgentConfigUploadFileReference).where(
            AgentConfigUploadFileReference.tenant_id == config.tenant_id,
            AgentConfigUploadFileReference.owner_kind == owner_kind,
            AgentConfigUploadFileReference.owner_id == config.id,
        )
    )
    file_ids = extract_agent_config_upload_file_ids(config.config_snapshot)
    if file_ids:
        connection.execute(
            insert(AgentConfigUploadFileReference),
            [
                {
                    "id": str(uuidv7()),
                    "tenant_id": config.tenant_id,
                    "owner_kind": owner_kind,
                    "owner_id": config.id,
                    "upload_file_id": file_id,
                }
                for file_id in file_ids
            ],
        )
    connection.execute(
        delete(AgentConfigToolFileReference).where(
            AgentConfigToolFileReference.tenant_id == config.tenant_id,
            AgentConfigToolFileReference.owner_kind == owner_kind,
            AgentConfigToolFileReference.owner_id == config.id,
        )
    )
    tool_file_ids = extract_agent_config_tool_file_ids(config.config_snapshot)
    if tool_file_ids:
        connection.execute(
            insert(AgentConfigToolFileReference),
            [
                {
                    "id": str(uuidv7()),
                    "tenant_id": config.tenant_id,
                    "owner_kind": owner_kind,
                    "owner_id": config.id,
                    "tool_file_id": file_id,
                }
                for file_id in tool_file_ids
            ],
        )
        adoption = config.__dict__.pop(_AGENT_CONFIG_TOOL_ADOPTION_ATTRIBUTE, None)
        if adoption is not None:
            adoption_checked_at, adoptable_tool_ids = adoption
            adopted_tool_ids = tuple(file_id for file_id in tool_file_ids if file_id in adoptable_tool_ids)
            result = connection.execute(
                update(ToolFile)
                .where(
                    ToolFile.tenant_id == config.tenant_id,
                    ToolFile.id.in_(adopted_tool_ids),
                    ToolFile.cleanup_started_at > adoption_checked_at,
                )
                .values(cleanup_started_at=None)
            )
            if result.rowcount != len(adopted_tool_ids):
                raise AgentConfigToolFilePendingDeletionError(adopted_tool_ids)
    _claim_detached_agent_config_tool_files(connection, config)
    candidates = config.__dict__.pop(_AGENT_CONFIG_CLEANUP_CANDIDATES_ATTRIBUTE, ())
    if candidates:
        config.__dict__[_ICON_CLEANUP_CANDIDATES_ATTRIBUTE] = candidates
        claim_detached_icon_upload_references(_mapper, connection, config)


def remove_agent_config_upload_references(
    mapper: Mapper[AgentConfigDraft] | Mapper[AgentConfigSnapshot],
    connection: Connection,
    config: AgentConfigDraft | AgentConfigSnapshot,
) -> None:
    config.config_snapshot = {}
    sync_agent_config_upload_references(mapper, connection, config)


def _icon_reference_matches_upload(reference: _IconUploadReference, upload: Any) -> bool:
    if reference.tenant_id is not None and upload.tenant_id != reference.tenant_id:
        return False
    if reference.account_id is not None:
        return upload.created_by_role == CreatorUserRole.ACCOUNT and upload.created_by == reference.account_id
    return True


def _prepare_icon_upload_change(
    connection: Connection,
    *,
    target: object,
    owner_name: str,
    old_reference: _IconUploadReference | None,
    new_reference: _IconUploadReference | None,
) -> None:
    """Lock an icon mutation's old/new uploads and retain its old candidate.

    Both rows are acquired by globally stable UploadFile id before the owner
    UPDATE/DELETE runs. This keeps reverse icon swaps ordered and lets the
    mapper's after-event persist an orphan marker in the owner transaction.
    """

    target.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    references = tuple(reference for reference in (old_reference, new_reference) if reference is not None)
    if not references:
        return
    upload_file_ids = tuple(sorted({reference.upload_file_id for reference in references}))
    rows = connection.execute(
        select(
            UploadFile.id,
            UploadFile.tenant_id,
            UploadFile.key,
            UploadFile.created_by_role,
            UploadFile.created_by,
            UploadFile.knowledge_cleanup_started_at,
        )
        .where(UploadFile.id.in_(upload_file_ids))
        .order_by(UploadFile.id)
        .with_for_update(of=UploadFile)
    ).all()
    uploads_by_id = {row.id: row for row in rows}

    if new_reference is not None:
        new_upload = uploads_by_id.get(new_reference.upload_file_id)
        if new_upload is None or not _icon_reference_matches_upload(new_reference, new_upload):
            if new_reference.account_id is not None:
                raise ValueError("local upload file does not belong to the account")
            raise ValueError(f"local upload file does not belong to the {owner_name} tenant")
        if new_upload.knowledge_cleanup_started_at is not None:
            raise UploadFilePendingDeletionError((new_reference.upload_file_id,))

    if old_reference is None or (
        new_reference is not None and old_reference.upload_file_id == new_reference.upload_file_id
    ):
        return
    old_upload = uploads_by_id.get(old_reference.upload_file_id)
    if old_upload is None or not _icon_reference_matches_upload(old_reference, old_upload):
        return
    target.__dict__[_ICON_CLEANUP_CANDIDATES_ATTRIBUTE] = (
        _IconCleanupCandidate(
            tenant_id=old_upload.tenant_id,
            file=UploadFileCleanup(id=old_upload.id, key=old_upload.key),
        ),
    )


def claim_detached_icon_upload_references(_mapper: Mapper[Any], connection: Connection, target: object) -> None:
    """Persist orphan markers after an icon owner mutation has reached SQL."""

    candidates = target.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, ())
    if not candidates:
        return
    claimed_at = datetime.now(UTC).replace(tzinfo=None)
    for tenant_id in sorted({candidate.tenant_id for candidate in candidates}):
        tenant_files = tuple(candidate.file for candidate in candidates if candidate.tenant_id == tenant_id)
        file_ids = tuple(file.id for file in tenant_files)
        remove_stale_knowledge_file_edges(connection, tenant_id=tenant_id, file_ids=file_ids)
        orphan_files = find_orphan_upload_files(connection, tenant_id=tenant_id, files=tenant_files)
        orphan_ids = tuple(file.id for file in orphan_files)
        if orphan_ids:
            connection.execute(
                update(UploadFile)
                .where(
                    UploadFile.tenant_id == tenant_id,
                    UploadFile.id.in_(orphan_ids),
                    UploadFile.knowledge_cleanup_started_at.is_(None),
                )
                .values(knowledge_cleanup_started_at=claimed_at)
            )


def guard_account_avatar_upload_reference(_mapper: Mapper[Account], connection: Connection, account: Account) -> None:
    """Fence an avatar change through its creator chain and retain the old file."""

    account.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    old_reference: _IconUploadReference | None = None
    state = sqlalchemy_inspect(account)
    if state.persistent:
        old_avatar = connection.scalar(select(Account.avatar).where(Account.id == account.id).limit(1))
        old_file_id = extract_account_avatar_upload_file_id(old_avatar)
        if old_file_id is not None:
            old_reference = _IconUploadReference(old_file_id, account_id=account.id)
    new_file_id = extract_account_avatar_upload_file_id(account.avatar)
    new_reference = _IconUploadReference(new_file_id, account_id=account.id) if new_file_id is not None else None
    if state.persistent and old_reference == new_reference:
        return
    _prepare_icon_upload_change(
        connection,
        target=account,
        owner_name="account",
        old_reference=old_reference,
        new_reference=new_reference,
    )


def guard_tenant_logo_upload_reference(_mapper: Mapper[Tenant], connection: Connection, tenant: Tenant) -> None:
    """Fence a workspace-logo change and retain the detached prior file."""

    tenant.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    old_reference: _IconUploadReference | None = None
    state = sqlalchemy_inspect(tenant)
    if state.persistent:
        old_config = connection.scalar(select(Tenant.custom_config).where(Tenant.id == tenant.id).limit(1))
        old_file_id = extract_tenant_logo_upload_file_id(old_config)
        if old_file_id is not None:
            old_reference = _IconUploadReference(old_file_id, tenant_id=tenant.id)
    new_file_id = extract_tenant_logo_upload_file_id(tenant.custom_config)
    new_reference = _IconUploadReference(new_file_id, tenant_id=tenant.id) if new_file_id is not None else None
    if state.persistent and old_reference == new_reference:
        return
    _prepare_icon_upload_change(
        connection,
        target=tenant,
        owner_name="workspace logo",
        old_reference=old_reference,
        new_reference=new_reference,
    )


def guard_dataset_icon_upload_reference(_mapper: Mapper[Dataset], connection: Connection, dataset: Dataset) -> None:
    dataset.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    old_reference: _IconUploadReference | None = None
    state = sqlalchemy_inspect(dataset)
    if state.persistent:
        persisted = connection.execute(
            select(Dataset.tenant_id, Dataset.icon_info).where(Dataset.id == dataset.id).limit(1)
        ).one_or_none()
        if persisted is not None:
            old_file_id = extract_icon_info_upload_file_id(persisted.icon_info)
            if old_file_id is not None:
                old_reference = _IconUploadReference(old_file_id, tenant_id=persisted.tenant_id)
    new_file_id = extract_icon_info_upload_file_id(dataset.icon_info)
    new_reference = _IconUploadReference(new_file_id, tenant_id=dataset.tenant_id) if new_file_id is not None else None
    if state.persistent and old_reference == new_reference:
        return
    _prepare_icon_upload_change(
        connection,
        target=dataset,
        owner_name="dataset",
        old_reference=old_reference,
        new_reference=new_reference,
    )


def guard_pipeline_template_icon_upload_reference(
    _mapper: Mapper[PipelineCustomizedTemplate],
    connection: Connection,
    template: PipelineCustomizedTemplate,
) -> None:
    template.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    old_reference: _IconUploadReference | None = None
    state = sqlalchemy_inspect(template)
    if state.persistent:
        persisted = connection.execute(
            select(PipelineCustomizedTemplate.tenant_id, PipelineCustomizedTemplate.icon)
            .where(PipelineCustomizedTemplate.id == template.id)
            .limit(1)
        ).one_or_none()
        if persisted is not None:
            old_file_id = extract_icon_info_upload_file_id(persisted.icon)
            if old_file_id is not None:
                old_reference = _IconUploadReference(old_file_id, tenant_id=persisted.tenant_id)
    new_file_id = extract_icon_info_upload_file_id(template.icon)
    new_reference = _IconUploadReference(new_file_id, tenant_id=template.tenant_id) if new_file_id is not None else None
    if state.persistent and old_reference == new_reference:
        return
    _prepare_icon_upload_change(
        connection,
        target=template,
        owner_name="pipeline template",
        old_reference=old_reference,
        new_reference=new_reference,
    )


def guard_agent_icon_upload_reference(_mapper: Mapper[Agent], connection: Connection, agent: Agent) -> None:
    agent.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    old_reference: _IconUploadReference | None = None
    state = sqlalchemy_inspect(agent)
    if state.persistent:
        persisted = connection.execute(
            select(Agent.tenant_id, Agent.icon_type, Agent.icon).where(Agent.id == agent.id).limit(1)
        ).one_or_none()
        if persisted is not None:
            old_file_id = extract_agent_icon_upload_file_id(persisted.icon_type, persisted.icon)
            if old_file_id is not None:
                old_reference = _IconUploadReference(old_file_id, tenant_id=persisted.tenant_id)
    new_file_id = extract_agent_icon_upload_file_id(agent.icon_type, agent.icon)
    new_reference = _IconUploadReference(new_file_id, tenant_id=agent.tenant_id) if new_file_id is not None else None
    if state.persistent and old_reference == new_reference:
        return
    _prepare_icon_upload_change(
        connection,
        target=agent,
        owner_name="agent",
        old_reference=old_reference,
        new_reference=new_reference,
    )


def guard_snippet_icon_upload_reference(
    _mapper: Mapper[CustomizedSnippet], connection: Connection, snippet: CustomizedSnippet
) -> None:
    snippet.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    old_reference: _IconUploadReference | None = None
    state = sqlalchemy_inspect(snippet)
    if state.persistent:
        persisted = connection.execute(
            select(CustomizedSnippet.tenant_id, CustomizedSnippet.icon_info)
            .where(CustomizedSnippet.id == snippet.id)
            .limit(1)
        ).one_or_none()
        if persisted is not None:
            old_file_id = extract_icon_info_upload_file_id(persisted.icon_info)
            if old_file_id is not None:
                old_reference = _IconUploadReference(old_file_id, tenant_id=persisted.tenant_id)
    new_file_id = extract_icon_info_upload_file_id(snippet.icon_info)
    new_reference = _IconUploadReference(new_file_id, tenant_id=snippet.tenant_id) if new_file_id is not None else None
    if state.persistent and old_reference == new_reference:
        return
    _prepare_icon_upload_change(
        connection,
        target=snippet,
        owner_name="snippet",
        old_reference=old_reference,
        new_reference=new_reference,
    )


def guard_mcp_icon_upload_reference(
    _mapper: Mapper[MCPToolProvider], connection: Connection, provider: MCPToolProvider
) -> None:
    provider.__dict__.pop(_ICON_CLEANUP_CANDIDATES_ATTRIBUTE, None)
    old_reference: _IconUploadReference | None = None
    state = sqlalchemy_inspect(provider)
    if state.persistent:
        persisted = connection.execute(
            select(MCPToolProvider.tenant_id, MCPToolProvider.icon).where(MCPToolProvider.id == provider.id).limit(1)
        ).one_or_none()
        if persisted is not None:
            old_file_id = extract_mcp_icon_upload_file_id(persisted.icon)
            if old_file_id is not None:
                old_reference = _IconUploadReference(old_file_id, tenant_id=persisted.tenant_id)
    new_file_id = extract_mcp_icon_upload_file_id(provider.icon)
    new_reference = _IconUploadReference(new_file_id, tenant_id=provider.tenant_id) if new_file_id is not None else None
    if state.persistent and old_reference == new_reference:
        return
    _prepare_icon_upload_change(
        connection,
        target=provider,
        owner_name="MCP provider",
        old_reference=old_reference,
        new_reference=new_reference,
    )


def prepare_icon_owner_deletion(_mapper: Mapper[object], connection: Connection, target: object) -> None:
    """Lock and snapshot the persisted icon reference before deleting its owner."""

    owner_name: str
    old_reference: _IconUploadReference | None = None
    site_app_id: str | None = None
    if isinstance(target, App):
        owner_name = "app"
        row = connection.execute(
            select(App.tenant_id, App.icon_type, App.icon).where(App.id == target.id).limit(1)
        ).one_or_none()
        if row is not None and (file_id := extract_app_icon_upload_file_id(row.icon_type, row.icon)) is not None:
            old_reference = _IconUploadReference(file_id, tenant_id=row.tenant_id)
    elif isinstance(target, Site):
        owner_name = "site"
        row = connection.execute(
            select(Site.app_id, Site.icon_type, Site.icon).where(Site.id == target.id).limit(1)
        ).one_or_none()
        if row is not None:
            tenant_id = connection.scalar(select(App.tenant_id).where(App.id == row.app_id).limit(1))
            if tenant_id is not None:
                site_app_id = row.app_id
            if (file_id := extract_app_icon_upload_file_id(row.icon_type, row.icon)) is not None:
                old_reference = _IconUploadReference(file_id, tenant_id=tenant_id)
    elif isinstance(target, Account):
        owner_name = "account"
        avatar = connection.scalar(select(Account.avatar).where(Account.id == target.id).limit(1))
        if (file_id := extract_account_avatar_upload_file_id(avatar)) is not None:
            old_reference = _IconUploadReference(file_id, account_id=target.id)
    elif isinstance(target, Tenant):
        owner_name = "workspace logo"
        custom_config = connection.scalar(select(Tenant.custom_config).where(Tenant.id == target.id).limit(1))
        if (file_id := extract_tenant_logo_upload_file_id(custom_config)) is not None:
            old_reference = _IconUploadReference(file_id, tenant_id=target.id)
    elif isinstance(target, Dataset):
        owner_name = "dataset"
        row = connection.execute(
            select(Dataset.tenant_id, Dataset.icon_info).where(Dataset.id == target.id).limit(1)
        ).one_or_none()
        if row is not None and (file_id := extract_icon_info_upload_file_id(row.icon_info)) is not None:
            old_reference = _IconUploadReference(file_id, tenant_id=row.tenant_id)
    elif isinstance(target, PipelineCustomizedTemplate):
        owner_name = "pipeline template"
        row = connection.execute(
            select(PipelineCustomizedTemplate.tenant_id, PipelineCustomizedTemplate.icon)
            .where(PipelineCustomizedTemplate.id == target.id)
            .limit(1)
        ).one_or_none()
        if row is not None and (file_id := extract_icon_info_upload_file_id(row.icon)) is not None:
            old_reference = _IconUploadReference(file_id, tenant_id=row.tenant_id)
    elif isinstance(target, Agent):
        owner_name = "agent"
        row = connection.execute(
            select(Agent.tenant_id, Agent.icon_type, Agent.icon).where(Agent.id == target.id).limit(1)
        ).one_or_none()
        if row is not None and (file_id := extract_agent_icon_upload_file_id(row.icon_type, row.icon)) is not None:
            old_reference = _IconUploadReference(file_id, tenant_id=row.tenant_id)
    elif isinstance(target, CustomizedSnippet):
        owner_name = "snippet"
        row = connection.execute(
            select(CustomizedSnippet.tenant_id, CustomizedSnippet.icon_info)
            .where(CustomizedSnippet.id == target.id)
            .limit(1)
        ).one_or_none()
        if row is not None and (file_id := extract_icon_info_upload_file_id(row.icon_info)) is not None:
            old_reference = _IconUploadReference(file_id, tenant_id=row.tenant_id)
    elif isinstance(target, MCPToolProvider):
        owner_name = "MCP provider"
        row = connection.execute(
            select(MCPToolProvider.tenant_id, MCPToolProvider.icon).where(MCPToolProvider.id == target.id).limit(1)
        ).one_or_none()
        if row is not None and (file_id := extract_mcp_icon_upload_file_id(row.icon)) is not None:
            old_reference = _IconUploadReference(file_id, tenant_id=row.tenant_id)
    else:
        raise TypeError(f"unsupported icon owner: {type(target).__name__}")

    _prepare_icon_upload_change(
        connection,
        target=target,
        owner_name=owner_name,
        old_reference=old_reference,
        new_reference=None,
    )
    if site_app_id is not None:
        current_app_id = connection.scalar(
            select(App.id).where(App.id == site_app_id).with_for_update(nowait=True).limit(1)
        )
        if current_app_id != site_app_id:
            raise LookupError("site owner changed while its icon reference was being fenced")


def _workflow_draft_variable_reference_changed(variable: WorkflowDraftVariable) -> bool:
    state = sqlalchemy_inspect(variable)
    if not state.persistent:
        return True
    return any(
        state.attrs[attribute].history.has_changes() for attribute in ("app_id", "node_id", "value_type", "value")
    )


def _resolve_workflow_owner_tenant(connection: Connection | Session, *, app_id: str) -> str:
    tenant_ids = tuple(
        connection.scalars(
            select(Workflow.tenant_id).where(Workflow.app_id == app_id).distinct().order_by(Workflow.tenant_id)
        ).all()
    )
    if not tenant_ids:
        raise LookupError("workflow draft variable owner no longer exists")
    if len(tenant_ids) != 1:
        raise ValueError("workflow draft variable app has ambiguous tenant ownership")
    return tenant_ids[0]


def _workflow_draft_variable_upload_file_ids(variable: WorkflowDraftVariable) -> tuple[str, ...]:
    return resolve_upload_file_ids_from_serialized_file_value(
        value_type=variable.value_type,
        value=variable.value,
    )


def guard_workflow_draft_variable_upload_references(
    _mapper: Mapper[WorkflowDraftVariable],
    connection: Connection,
    variable: WorkflowDraftVariable,
) -> None:
    """Fence ordinary persisted workflow file values in their writer transaction."""

    if not _workflow_draft_variable_reference_changed(variable):
        return
    file_ids = _workflow_draft_variable_upload_file_ids(variable)
    if not file_ids:
        return
    tenant_id = _resolve_workflow_owner_tenant(connection, app_id=variable.app_id)
    for upload_file_id in sorted(file_ids):
        _guard_reusable_upload_file(
            connection,
            tenant_id=tenant_id,
            upload_file_id=upload_file_id,
            owner_name="workflow draft variable",
        )


def guard_knowledge_upload_reference(
    _mapper: Mapper[KnowledgeUploadFileReference],
    connection: Connection,
    reference: KnowledgeUploadFileReference,
) -> None:
    _guard_reusable_upload_file(
        connection,
        tenant_id=reference.tenant_id,
        upload_file_id=reference.upload_file_id,
        owner_name="knowledge reference",
    )


def guard_segment_attachment_upload_reference(
    _mapper: Mapper[SegmentAttachmentBinding],
    connection: Connection,
    binding: SegmentAttachmentBinding,
) -> None:
    _guard_reusable_upload_file(
        connection,
        tenant_id=binding.tenant_id,
        upload_file_id=binding.attachment_id,
        owner_name="segment attachment",
    )


def guard_workflow_draft_variable_normalized_upload_reference(
    _mapper: Mapper[WorkflowDraftVariableUploadFileReference],
    connection: Connection,
    reference: WorkflowDraftVariableUploadFileReference,
) -> None:
    _guard_reusable_upload_file(
        connection,
        tenant_id=reference.tenant_id,
        upload_file_id=reference.upload_file_id,
        owner_name="workflow draft variable reference",
    )


def guard_workflow_draft_variable_file_upload_reference(
    _mapper: Mapper[WorkflowDraftVariableFile],
    connection: Connection,
    owner: WorkflowDraftVariableFile,
) -> None:
    _guard_reusable_upload_file(
        connection,
        tenant_id=owner.tenant_id,
        upload_file_id=owner.upload_file_id,
        owner_name="workflow draft variable offload",
    )


def guard_workflow_node_execution_offload_upload_reference(
    _mapper: Mapper[WorkflowNodeExecutionOffload],
    connection: Connection,
    offload: WorkflowNodeExecutionOffload,
) -> None:
    _guard_reusable_upload_file(
        connection,
        tenant_id=offload.tenant_id,
        upload_file_id=offload.file_id,
        owner_name="workflow node execution offload",
    )


def guard_human_input_upload_reference(
    _mapper: Mapper[HumanInputFormUploadFile],
    connection: Connection,
    upload: HumanInputFormUploadFile,
) -> None:
    _guard_reusable_upload_file(
        connection,
        tenant_id=upload.tenant_id,
        upload_file_id=upload.upload_file_id,
        owner_name="human input form",
    )


def sync_workflow_draft_variable_upload_references(
    _mapper: Mapper[WorkflowDraftVariable],
    connection: Connection,
    variable: WorkflowDraftVariable,
) -> None:
    """Replace normalized edges after an ORM draft-variable insert or update."""

    if not _workflow_draft_variable_reference_changed(variable):
        return
    connection.execute(
        delete(WorkflowDraftVariableUploadFileReference).where(
            WorkflowDraftVariableUploadFileReference.draft_variable_id == variable.id,
        )
    )
    file_ids = _workflow_draft_variable_upload_file_ids(variable)
    if not file_ids:
        return
    tenant_id = _resolve_workflow_owner_tenant(connection, app_id=variable.app_id)
    connection.execute(
        insert(WorkflowDraftVariableUploadFileReference),
        [
            {
                "id": str(uuidv7()),
                "tenant_id": tenant_id,
                "app_id": variable.app_id,
                "draft_variable_id": variable.id,
                "node_id": variable.node_id,
                "upload_file_id": upload_file_id,
            }
            for upload_file_id in file_ids
        ],
    )


def _knowledge_owner_reference_changed(target: Document | DocumentSegment) -> bool:
    state = sqlalchemy_inspect(target)
    if not state.persistent:
        return True
    attributes = (
        ("id", "tenant_id", "dataset_id", "data_source_type", "data_source_info")
        if isinstance(target, Document)
        else ("id", "tenant_id", "dataset_id", "document_id", "content")
    )
    return any(state.attrs[attribute].history.has_changes() for attribute in attributes)


def _decode_document_source_info(raw_info: object) -> Mapping[str, object]:
    if not isinstance(raw_info, str):
        return {}
    try:
        source_info = json.loads(raw_info)
    except (TypeError, ValueError):
        return {}
    return source_info if isinstance(source_info, Mapping) else {}


def _lock_knowledge_reference_owner_chain(
    connection: Connection,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_id: str | None,
    target_persistent: bool,
) -> None:
    """Validate knowledge ownership without waiting behind a reverse owner lock.

    Upload files are locked first across every owner domain. Knowledge writers
    that already hold Dataset/Document locks can current-read those same rows;
    direct ORM writers fail fast when another transaction owns the hierarchy.
    """

    dataset_owner = connection.scalar(
        select(Dataset.id).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id).with_for_update(nowait=True)
    )
    if dataset_owner is None:
        raise LookupError("knowledge reference dataset owner no longer exists")
    if segment_id is not None or target_persistent:
        document_owner = connection.scalar(
            select(Document.id)
            .where(
                Document.id == document_id,
                Document.dataset_id == dataset_id,
                Document.tenant_id == tenant_id,
            )
            .with_for_update(nowait=True)
        )
        if document_owner is None:
            raise LookupError("knowledge reference document owner no longer exists")
    if segment_id is not None and target_persistent:
        segment_owner = connection.scalar(
            select(DocumentSegment.id)
            .where(
                DocumentSegment.id == segment_id,
                DocumentSegment.document_id == document_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.tenant_id == tenant_id,
            )
            .with_for_update(nowait=True)
        )
        if segment_owner is None:
            raise LookupError("knowledge reference segment owner no longer exists")


def guard_knowledge_owner_upload_references(
    _mapper: Mapper[Document] | Mapper[DocumentSegment],
    connection: Connection,
    target: Document | DocumentSegment,
) -> None:
    """Fence serialized Document/Segment uploads before their owner SQL runs."""

    target.__dict__.pop(_KNOWLEDGE_REFERENCE_MUTATION_ATTRIBUTE, None)
    if not _knowledge_owner_reference_changed(target):
        return

    state = sqlalchemy_inspect(target)
    tenant_id = target.tenant_id
    dataset_id = target.dataset_id
    document_id = target.id if isinstance(target, Document) else target.document_id
    segment_id = target.id if isinstance(target, DocumentSegment) else None
    kind = DOCUMENT_SOURCE_REFERENCE if isinstance(target, Document) else SEGMENT_IMAGE_REFERENCE
    resource_id = target.id

    old_serialized_ids: tuple[str, ...] = ()
    if state.persistent:
        if isinstance(target, Document):
            persisted = connection.execute(
                select(
                    Document.tenant_id,
                    Document.dataset_id,
                    Document.data_source_type,
                    Document.data_source_info,
                ).where(Document.id == target.id)
            ).one_or_none()
            if persisted is None:
                raise LookupError("knowledge reference document owner no longer exists")
            if persisted.tenant_id != tenant_id or persisted.dataset_id != dataset_id:
                raise ValueError("knowledge reference document ownership is immutable")
            old_serialized_ids = extract_document_source_file_ids(
                persisted.data_source_type,
                _decode_document_source_info(persisted.data_source_info),
            )
        else:
            persisted = connection.execute(
                select(
                    DocumentSegment.tenant_id,
                    DocumentSegment.dataset_id,
                    DocumentSegment.document_id,
                    DocumentSegment.content,
                ).where(DocumentSegment.id == target.id)
            ).one_or_none()
            if persisted is None:
                raise LookupError("knowledge reference segment owner no longer exists")
            if (
                persisted.tenant_id != tenant_id
                or persisted.dataset_id != dataset_id
                or persisted.document_id != document_id
            ):
                raise ValueError("knowledge reference segment ownership is immutable")
            old_serialized_ids = extract_upload_file_ids_from_markdown(persisted.content)

    old_edge_ids = _unique(
        connection.scalars(
            select(KnowledgeUploadFileReference.upload_file_id).where(
                KnowledgeUploadFileReference.tenant_id == tenant_id,
                KnowledgeUploadFileReference.dataset_id == dataset_id,
                KnowledgeUploadFileReference.document_id == document_id,
                KnowledgeUploadFileReference.kind == kind,
                KnowledgeUploadFileReference.resource_id == resource_id,
            )
        ).all()
    )
    if isinstance(target, Document):
        new_file_ids = extract_document_source_file_ids(
            target.data_source_type,
            target.data_source_info_dict,
        )
    else:
        new_file_ids = extract_upload_file_ids_from_markdown(target.content)

    old_file_ids = _unique((*old_edge_ids, *old_serialized_ids))
    if not old_file_ids and not new_file_ids:
        return
    all_file_ids = tuple(sorted(_unique((*old_file_ids, *new_file_ids))))
    uploads = connection.execute(
        select(
            UploadFile.id,
            UploadFile.tenant_id,
            UploadFile.key,
            UploadFile.knowledge_cleanup_started_at,
        )
        .where(UploadFile.id.in_(all_file_ids))
        .order_by(UploadFile.id)
        .with_for_update(of=UploadFile)
    ).all()
    uploads_by_id = {upload.id: upload for upload in uploads}
    missing_new_ids = tuple(
        file_id
        for file_id in new_file_ids
        if file_id not in uploads_by_id or uploads_by_id[file_id].tenant_id != tenant_id
    )
    if missing_new_ids:
        raise ValueError(f"upload files do not exist in tenant: {', '.join(missing_new_ids)}")
    pending_new_ids = tuple(
        file_id for file_id in new_file_ids if uploads_by_id[file_id].knowledge_cleanup_started_at is not None
    )
    if pending_new_ids:
        raise UploadFilePendingDeletionError(pending_new_ids)

    _lock_knowledge_reference_owner_chain(
        connection,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=segment_id,
        target_persistent=state.persistent,
    )
    new_id_set = set(new_file_ids)
    detached_files = tuple(
        UploadFileCleanup(id=file_id, key=uploads_by_id[file_id].key)
        for file_id in old_file_ids
        if file_id not in new_id_set and file_id in uploads_by_id and uploads_by_id[file_id].tenant_id == tenant_id
    )
    target.__dict__[_KNOWLEDGE_REFERENCE_MUTATION_ATTRIBUTE] = _KnowledgeReferenceMutation(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        kind=kind,
        resource_id=resource_id,
        new_file_ids=new_file_ids,
        detached_files=detached_files,
    )


def sync_knowledge_owner_upload_references(
    _mapper: Mapper[Document] | Mapper[DocumentSegment],
    connection: Connection,
    target: Document | DocumentSegment,
) -> None:
    """Replace normalized edges and retain detached files in the owner transaction."""

    mutation = target.__dict__.pop(_KNOWLEDGE_REFERENCE_MUTATION_ATTRIBUTE, None)
    if not isinstance(mutation, _KnowledgeReferenceMutation):
        return
    connection.execute(
        delete(KnowledgeUploadFileReference).where(
            KnowledgeUploadFileReference.tenant_id == mutation.tenant_id,
            KnowledgeUploadFileReference.dataset_id == mutation.dataset_id,
            KnowledgeUploadFileReference.document_id == mutation.document_id,
            KnowledgeUploadFileReference.kind == mutation.kind,
            KnowledgeUploadFileReference.resource_id == mutation.resource_id,
        )
    )
    if mutation.new_file_ids:
        connection.execute(
            insert(KnowledgeUploadFileReference),
            [
                {
                    "id": str(uuidv7()),
                    "tenant_id": mutation.tenant_id,
                    "upload_file_id": file_id,
                    "dataset_id": mutation.dataset_id,
                    "document_id": mutation.document_id,
                    "kind": mutation.kind,
                    "resource_id": mutation.resource_id,
                }
                for file_id in mutation.new_file_ids
            ],
        )
    if not mutation.detached_files:
        return
    detached_ids = tuple(file.id for file in mutation.detached_files)
    remove_stale_knowledge_file_edges(connection, tenant_id=mutation.tenant_id, file_ids=detached_ids)
    orphan_files = find_orphan_upload_files(
        connection,
        tenant_id=mutation.tenant_id,
        files=mutation.detached_files,
    )
    orphan_ids = tuple(file.id for file in orphan_files)
    if orphan_ids:
        connection.execute(
            update(UploadFile)
            .where(
                UploadFile.tenant_id == mutation.tenant_id,
                UploadFile.id.in_(orphan_ids),
                UploadFile.knowledge_cleanup_started_at.is_(None),
            )
            .values(knowledge_cleanup_started_at=datetime.now(UTC).replace(tzinfo=None))
        )


def register_upload_file_reference_guards() -> None:
    """Register idempotent ORM persistence guards for reusable upload files."""

    icon_owner_models = (
        App,
        Site,
        Account,
        Tenant,
        Dataset,
        PipelineCustomizedTemplate,
        Agent,
        CustomizedSnippet,
        MCPToolProvider,
    )
    for operation in ("before_insert", "before_update"):
        if not event.contains(MessageFile, operation, guard_local_message_file_upload_reference):
            event.listen(MessageFile, operation, guard_local_message_file_upload_reference)
        if not event.contains(App, operation, guard_app_icon_upload_reference):
            event.listen(App, operation, guard_app_icon_upload_reference)
        if not event.contains(Site, operation, guard_site_icon_upload_reference):
            event.listen(Site, operation, guard_site_icon_upload_reference)
        if not event.contains(Account, operation, guard_account_avatar_upload_reference):
            event.listen(Account, operation, guard_account_avatar_upload_reference)
        if not event.contains(Tenant, operation, guard_tenant_logo_upload_reference):
            event.listen(Tenant, operation, guard_tenant_logo_upload_reference)
        if not event.contains(Dataset, operation, guard_dataset_icon_upload_reference):
            event.listen(Dataset, operation, guard_dataset_icon_upload_reference)
        if not event.contains(PipelineCustomizedTemplate, operation, guard_pipeline_template_icon_upload_reference):
            event.listen(PipelineCustomizedTemplate, operation, guard_pipeline_template_icon_upload_reference)
        if not event.contains(Agent, operation, guard_agent_icon_upload_reference):
            event.listen(Agent, operation, guard_agent_icon_upload_reference)
        if not event.contains(CustomizedSnippet, operation, guard_snippet_icon_upload_reference):
            event.listen(CustomizedSnippet, operation, guard_snippet_icon_upload_reference)
        if not event.contains(MCPToolProvider, operation, guard_mcp_icon_upload_reference):
            event.listen(MCPToolProvider, operation, guard_mcp_icon_upload_reference)
        if not event.contains(WorkflowDraftVariable, operation, guard_workflow_draft_variable_upload_references):
            event.listen(WorkflowDraftVariable, operation, guard_workflow_draft_variable_upload_references)
        for model in (AgentConfigDraft, AgentConfigSnapshot):
            if not event.contains(model, operation, guard_agent_config_upload_references):
                event.listen(model, operation, guard_agent_config_upload_references)
        if not event.contains(KnowledgeUploadFileReference, operation, guard_knowledge_upload_reference):
            event.listen(KnowledgeUploadFileReference, operation, guard_knowledge_upload_reference)
        if not event.contains(
            AgentConfigUploadFileReference,
            operation,
            guard_agent_config_normalized_upload_reference,
        ):
            event.listen(
                AgentConfigUploadFileReference,
                operation,
                guard_agent_config_normalized_upload_reference,
            )
        if not event.contains(
            AgentConfigToolFileReference,
            operation,
            guard_agent_config_normalized_tool_reference,
        ):
            event.listen(
                AgentConfigToolFileReference,
                operation,
                guard_agent_config_normalized_tool_reference,
            )
        if not event.contains(SegmentAttachmentBinding, operation, guard_segment_attachment_upload_reference):
            event.listen(SegmentAttachmentBinding, operation, guard_segment_attachment_upload_reference)
        if not event.contains(
            WorkflowDraftVariableUploadFileReference,
            operation,
            guard_workflow_draft_variable_normalized_upload_reference,
        ):
            event.listen(
                WorkflowDraftVariableUploadFileReference,
                operation,
                guard_workflow_draft_variable_normalized_upload_reference,
            )
        if not event.contains(
            WorkflowDraftVariableFile,
            operation,
            guard_workflow_draft_variable_file_upload_reference,
        ):
            event.listen(
                WorkflowDraftVariableFile,
                operation,
                guard_workflow_draft_variable_file_upload_reference,
            )
        if not event.contains(
            WorkflowNodeExecutionOffload,
            operation,
            guard_workflow_node_execution_offload_upload_reference,
        ):
            event.listen(
                WorkflowNodeExecutionOffload,
                operation,
                guard_workflow_node_execution_offload_upload_reference,
            )
        if not event.contains(HumanInputFormUploadFile, operation, guard_human_input_upload_reference):
            event.listen(HumanInputFormUploadFile, operation, guard_human_input_upload_reference)
        for model in (Document, DocumentSegment):
            if not event.contains(model, operation, guard_knowledge_owner_upload_references):
                event.listen(model, operation, guard_knowledge_owner_upload_references)
        sync_operation = "after_insert" if operation == "before_insert" else "after_update"
        if not event.contains(WorkflowDraftVariable, sync_operation, sync_workflow_draft_variable_upload_references):
            event.listen(WorkflowDraftVariable, sync_operation, sync_workflow_draft_variable_upload_references)
        for model in (AgentConfigDraft, AgentConfigSnapshot):
            if not event.contains(model, sync_operation, sync_agent_config_upload_references):
                event.listen(model, sync_operation, sync_agent_config_upload_references)
        for model in (Document, DocumentSegment):
            if not event.contains(model, sync_operation, sync_knowledge_owner_upload_references):
                event.listen(model, sync_operation, sync_knowledge_owner_upload_references)
    for model in icon_owner_models:
        if not event.contains(model, "before_delete", prepare_icon_owner_deletion):
            event.listen(model, "before_delete", prepare_icon_owner_deletion)
        for operation in ("after_update", "after_delete"):
            if not event.contains(model, operation, claim_detached_icon_upload_references):
                event.listen(model, operation, claim_detached_icon_upload_references)
    for model in (AgentConfigDraft, AgentConfigSnapshot):
        if not event.contains(model, "before_delete", prepare_agent_config_deletion):
            event.listen(model, "before_delete", prepare_agent_config_deletion)
        if not event.contains(model, "after_delete", remove_agent_config_upload_references):
            event.listen(model, "after_delete", remove_agent_config_upload_references)


def _unique(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(value for value in values if value))


def extract_document_source_file_ids(
    data_source_type: str | DataSourceType,
    data_source_info: Mapping[str, object],
) -> tuple[str, ...]:
    """Resolve storage-backed document sources through the shared file format."""

    source_type = data_source_type.value if isinstance(data_source_type, DataSourceType) else data_source_type
    if source_type == DataSourceType.UPLOAD_FILE.value:
        upload_file_id = data_source_info.get("upload_file_id")
        return (upload_file_id,) if isinstance(upload_file_id, str) and upload_file_id else ()
    if source_type != DataSourceType.LOCAL_FILE.value:
        return ()

    file_ids: list[str] = []
    resolved_id = resolve_file_record_id(data_source_info)
    if resolved_id:
        file_ids.append(resolved_id)
    # Rows produced by the first pipeline migration used ``real_file_id``;
    # accept it at this single compatibility boundary as well.
    for key in ("upload_file_id", "real_file_id"):
        value = data_source_info.get(key)
        if isinstance(value, str) and value:
            file_ids.append(value)
    return _unique(file_ids)


def lock_upload_files_for_knowledge_reference(
    session: Session,
    *,
    tenant_id: str,
    file_ids: Sequence[str],
) -> tuple[UploadFile, ...]:
    """Lock files in stable order and reject references racing with cleanup."""

    unique_file_ids = tuple(sorted(_unique(file_ids)))
    if not unique_file_ids:
        return ()
    files = tuple(
        session.scalars(
            select(UploadFile)
            .where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(unique_file_ids))
            .order_by(UploadFile.id)
            .with_for_update()
        ).all()
    )
    found_ids = {file.id for file in files}
    missing_ids = tuple(file_id for file_id in unique_file_ids if file_id not in found_ids)
    if missing_ids:
        raise ValueError(f"upload files do not exist in tenant: {', '.join(missing_ids)}")
    pending_ids = tuple(file.id for file in files if file.knowledge_cleanup_started_at is not None)
    if pending_ids:
        raise UploadFilePendingDeletionError(pending_ids)
    return files


def _lock_upload_files_for_cleanup(
    session: Session,
    *,
    tenant_id: str,
    file_ids: Sequence[str],
    nowait: bool = False,
) -> tuple[UploadFile, ...]:
    """Lock cleanup candidates in the same stable order used by reference writers."""

    unique_file_ids = tuple(sorted(_unique(file_ids)))
    if not unique_file_ids:
        return ()
    return tuple(
        session.scalars(
            select(UploadFile)
            .where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(unique_file_ids))
            .order_by(UploadFile.id)
            .with_for_update(nowait=nowait)
        ).all()
    )


def _draft_variable_identity_predicate(variable: WorkflowDraftVariable) -> ColumnElement[bool]:
    user_predicate = (
        WorkflowDraftVariable.user_id.is_(None)
        if variable.user_id is None
        else WorkflowDraftVariable.user_id == variable.user_id
    )
    return and_(
        WorkflowDraftVariable.app_id == variable.app_id,
        user_predicate,
        WorkflowDraftVariable.node_id == variable.node_id,
        WorkflowDraftVariable.name == variable.name,
    )


@dataclass(frozen=True)
class _WorkflowDraftVariableTenantReplacement:
    tenant_id: str
    ordinary_candidates: tuple[UploadFileCleanup, ...]
    draft_file_ids: tuple[str, ...]


@dataclass(frozen=True)
class WorkflowDraftVariableUpsertFence:
    replacements: tuple[_WorkflowDraftVariableTenantReplacement, ...] = ()


def fence_workflow_draft_variable_upload_file_upsert(
    session: Session,
    draft_variables: Sequence[WorkflowDraftVariable],
    *,
    ignore_existing: bool,
) -> WorkflowDraftVariableUpsertFence:
    """Fence file references before the Core bulk-upsert bypasses ORM events."""

    variables = tuple(draft_variables)
    if not variables:
        return WorkflowDraftVariableUpsertFence()
    initial_rows = tuple(
        session.execute(
            select(
                WorkflowDraftVariable.id,
                WorkflowDraftVariable.app_id,
                WorkflowDraftVariable.user_id,
                WorkflowDraftVariable.node_id,
                WorkflowDraftVariable.name,
                WorkflowDraftVariable.value_type,
                WorkflowDraftVariable.value,
                WorkflowDraftVariable.file_id,
            )
            .where(or_(*(_draft_variable_identity_predicate(variable) for variable in variables)))
            .order_by(WorkflowDraftVariable.id)
        ).all()
    )
    if ignore_existing:
        existing_keys = {(row.app_id, row.user_id, row.node_id, row.name) for row in initial_rows}
        variables = tuple(
            variable
            for variable in variables
            if (variable.app_id, variable.user_id, variable.node_id, variable.name) not in existing_keys
        )

    old_ordinary_ids_by_app: dict[str, list[str]] = {}
    old_draft_file_ids_by_app: dict[str, list[str]] = {}
    for row in initial_rows if not ignore_existing else ():
        old_ordinary_ids_by_app.setdefault(row.app_id, []).extend(
            resolve_upload_file_ids_from_serialized_file_value(value_type=row.value_type, value=row.value)
        )
        if row.file_id:
            old_draft_file_ids_by_app.setdefault(row.app_id, []).append(row.file_id)
    new_ordinary_ids_by_app: dict[str, list[str]] = {}
    for variable in variables:
        new_ordinary_ids_by_app.setdefault(variable.app_id, []).extend(
            _workflow_draft_variable_upload_file_ids(variable)
        )
    relevant_app_ids = (
        set(old_ordinary_ids_by_app)
        | set(old_draft_file_ids_by_app)
        | {app_id for app_id, file_ids in new_ordinary_ids_by_app.items() if file_ids}
    )
    if not relevant_app_ids:
        return WorkflowDraftVariableUpsertFence()
    tenant_by_app = {
        app_id: _resolve_workflow_owner_tenant(session, app_id=app_id) for app_id in sorted(relevant_app_ids)
    }
    old_ordinary_ids_by_tenant: dict[str, list[str]] = {}
    old_draft_file_ids_by_tenant: dict[str, list[str]] = {}
    for app_id, file_ids in old_ordinary_ids_by_app.items():
        old_ordinary_ids_by_tenant.setdefault(tenant_by_app[app_id], []).extend(file_ids)
    for app_id, file_ids in old_draft_file_ids_by_app.items():
        old_draft_file_ids_by_tenant.setdefault(tenant_by_app[app_id], []).extend(file_ids)

    old_draft_file_rows = tuple(
        session.execute(
            select(
                WorkflowDraftVariableFile.id,
                WorkflowDraftVariableFile.tenant_id,
                WorkflowDraftVariableFile.upload_file_id,
            ).where(
                WorkflowDraftVariableFile.id.in_(
                    tuple(file_id for ids in old_draft_file_ids_by_tenant.values() for file_id in ids)
                )
            )
        ).all()
    )

    file_ids_by_tenant = {tenant_id: list(file_ids) for tenant_id, file_ids in old_ordinary_ids_by_tenant.items()}
    for row in old_draft_file_rows:
        file_ids_by_tenant.setdefault(row.tenant_id, []).append(row.upload_file_id)
    for app_id, file_ids in new_ordinary_ids_by_app.items():
        if file_ids:
            file_ids_by_tenant.setdefault(tenant_by_app[app_id], []).extend(file_ids)
    locked_uploads_by_tenant: dict[str, tuple[UploadFile, ...]] = {}
    for tenant_id in sorted(file_ids_by_tenant):
        locked_uploads_by_tenant[tenant_id] = _lock_upload_files_for_cleanup(
            session,
            tenant_id=tenant_id,
            file_ids=file_ids_by_tenant[tenant_id],
        )
    new_file_ids_by_tenant: dict[str, list[str]] = {}
    for app_id, file_ids in new_ordinary_ids_by_app.items():
        if file_ids:
            new_file_ids_by_tenant.setdefault(tenant_by_app[app_id], []).extend(file_ids)
    for tenant_id in sorted(new_file_ids_by_tenant):
        lock_upload_files_for_knowledge_reference(
            session,
            tenant_id=tenant_id,
            file_ids=new_file_ids_by_tenant[tenant_id],
        )

    for app_id in sorted(tenant_by_app):
        locked_owner_tenants = tuple(
            session.scalars(
                select(Workflow.tenant_id)
                .where(Workflow.app_id == app_id)
                .order_by(Workflow.id)
                .with_for_update(nowait=True)
            ).all()
        )
        if not locked_owner_tenants or set(locked_owner_tenants) != {tenant_by_app[app_id]}:
            raise RuntimeError("workflow owner changed while draft-variable uploads were being fenced")

    if initial_rows:
        locked_rows = tuple(
            session.execute(
                select(
                    WorkflowDraftVariable.id,
                    WorkflowDraftVariable.app_id,
                    WorkflowDraftVariable.user_id,
                    WorkflowDraftVariable.node_id,
                    WorkflowDraftVariable.name,
                    WorkflowDraftVariable.value_type,
                    WorkflowDraftVariable.value,
                    WorkflowDraftVariable.file_id,
                )
                .where(WorkflowDraftVariable.id.in_(tuple(row.id for row in initial_rows)))
                .order_by(WorkflowDraftVariable.id)
                .with_for_update(nowait=True)
            ).all()
        )
        if locked_rows != initial_rows:
            raise RuntimeError("draft variable changed while its upload references were being fenced")

    replacements: list[_WorkflowDraftVariableTenantReplacement] = []
    for tenant_id in sorted(set(old_ordinary_ids_by_tenant) | set(old_draft_file_ids_by_tenant)):
        uploads_by_id = {file.id: file for file in locked_uploads_by_tenant.get(tenant_id, ())}
        replacements.append(
            _WorkflowDraftVariableTenantReplacement(
                tenant_id=tenant_id,
                ordinary_candidates=tuple(
                    UploadFileCleanup(id=file_id, key=uploads_by_id[file_id].key)
                    for file_id in _unique(old_ordinary_ids_by_tenant.get(tenant_id, ()))
                    if file_id in uploads_by_id
                ),
                draft_file_ids=_unique(old_draft_file_ids_by_tenant.get(tenant_id, ())),
            )
        )
    return WorkflowDraftVariableUpsertFence(replacements=tuple(replacements))


def synchronize_workflow_draft_variable_upload_file_upsert(
    session: Session,
    draft_variables: Sequence[WorkflowDraftVariable],
    *,
    replacement_fence: WorkflowDraftVariableUpsertFence | None = None,
) -> None:
    """Persist normalized edges for the actual winners of a bulk upsert."""

    variables = tuple(draft_variables)
    if not variables:
        return
    persisted_variables = tuple(
        session.scalars(
            select(WorkflowDraftVariable)
            .where(or_(*(_draft_variable_identity_predicate(variable) for variable in variables)))
            .execution_options(populate_existing=True)
        ).all()
    )
    persisted_ids = tuple(variable.id for variable in persisted_variables)
    if not persisted_ids:
        return
    session.execute(
        delete(WorkflowDraftVariableUploadFileReference).where(
            WorkflowDraftVariableUploadFileReference.draft_variable_id.in_(persisted_ids),
        )
    )
    file_ids_by_variable = {
        variable.id: _workflow_draft_variable_upload_file_ids(variable) for variable in persisted_variables
    }
    tenant_by_app: dict[str, str] = {}
    file_ids_by_tenant: dict[str, list[str]] = {}
    for variable in persisted_variables:
        file_ids = file_ids_by_variable[variable.id]
        if not file_ids:
            continue
        tenant_id = tenant_by_app.get(variable.app_id)
        if tenant_id is None:
            tenant_id = _resolve_workflow_owner_tenant(session, app_id=variable.app_id)
            tenant_by_app[variable.app_id] = tenant_id
        file_ids_by_tenant.setdefault(tenant_id, []).extend(file_ids)
    for tenant_id in sorted(file_ids_by_tenant):
        lock_upload_files_for_knowledge_reference(
            session,
            tenant_id=tenant_id,
            file_ids=file_ids_by_tenant[tenant_id],
        )

    session.add_all(
        WorkflowDraftVariableUploadFileReference(
            tenant_id=tenant_by_app[variable.app_id],
            app_id=variable.app_id,
            draft_variable_id=variable.id,
            node_id=variable.node_id,
            upload_file_id=upload_file_id,
        )
        for variable in persisted_variables
        for upload_file_id in file_ids_by_variable[variable.id]
    )
    session.flush()

    for replacement in replacement_fence.replacements if replacement_fence is not None else ():
        referenced_draft_file_ids = set(
            session.scalars(
                select(WorkflowDraftVariable.file_id).where(
                    WorkflowDraftVariable.file_id.in_(replacement.draft_file_ids),
                    WorkflowDraftVariable.file_id.is_not(None),
                )
            ).all()
        )
        detached_draft_file_ids = tuple(
            file_id for file_id in replacement.draft_file_ids if file_id not in referenced_draft_file_ids
        )
        if detached_draft_file_ids:
            detach_workflow_draft_variable_files_and_claim_uploads(
                session,
                tenant_id=replacement.tenant_id,
                draft_file_ids=detached_draft_file_ids,
            )
        if replacement.ordinary_candidates:
            claim_orphan_upload_files(
                session,
                tenant_id=replacement.tenant_id,
                files=replacement.ordinary_candidates,
            )


def _replace_references(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    kind: str,
    resource_id: str,
    file_ids: Sequence[str],
) -> tuple[UploadFileCleanup, ...]:
    unique_file_ids = _unique(file_ids)
    existing_file_ids = _unique(
        session.scalars(
            select(KnowledgeUploadFileReference.upload_file_id).where(
                KnowledgeUploadFileReference.tenant_id == tenant_id,
                KnowledgeUploadFileReference.dataset_id == dataset_id,
                KnowledgeUploadFileReference.document_id == document_id,
                KnowledgeUploadFileReference.kind == kind,
                KnowledgeUploadFileReference.resource_id == resource_id,
            )
        ).all()
    )
    locked_files = lock_upload_files_for_knowledge_reference(
        session,
        tenant_id=tenant_id,
        file_ids=(*existing_file_ids, *unique_file_ids),
    )
    snapshots = {file.id: UploadFileCleanup(id=file.id, key=file.key) for file in locked_files}
    session.execute(
        delete(KnowledgeUploadFileReference).where(
            KnowledgeUploadFileReference.tenant_id == tenant_id,
            KnowledgeUploadFileReference.dataset_id == dataset_id,
            KnowledgeUploadFileReference.document_id == document_id,
            KnowledgeUploadFileReference.kind == kind,
            KnowledgeUploadFileReference.resource_id == resource_id,
        )
    )
    session.add_all(
        KnowledgeUploadFileReference(
            tenant_id=tenant_id,
            upload_file_id=file_id,
            dataset_id=dataset_id,
            document_id=document_id,
            kind=kind,
            resource_id=resource_id,
        )
        for file_id in unique_file_ids
    )
    replacement_ids = set(unique_file_ids)
    return tuple(snapshots[file_id] for file_id in existing_file_ids if file_id not in replacement_ids)


def replace_document_upload_file_references(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    data_source_type: str | DataSourceType,
    data_source_info: Mapping[str, object],
) -> tuple[UploadFileCleanup, ...]:
    return _replace_references(
        session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        kind=DOCUMENT_SOURCE_REFERENCE,
        resource_id=document_id,
        file_ids=extract_document_source_file_ids(data_source_type, data_source_info),
    )


def replace_segment_image_upload_file_references(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_id: str,
    content: str,
) -> tuple[UploadFileCleanup, ...]:
    return _replace_references(
        session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        kind=SEGMENT_IMAGE_REFERENCE,
        resource_id=segment_id,
        file_ids=extract_upload_file_ids_from_markdown(content),
    )


def _lock_knowledge_owners_for_cleanup(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    segment_ids: Sequence[str] = (),
) -> None:
    """Current-read owner rows after UploadFile locks without waiting in reverse order."""

    session.scalars(
        select(Dataset.id).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id).with_for_update(nowait=True)
    ).all()
    unique_document_ids = tuple(sorted(_unique(document_ids)))
    if unique_document_ids:
        session.scalars(
            select(Document.id)
            .where(
                Document.tenant_id == tenant_id,
                Document.dataset_id == dataset_id,
                Document.id.in_(unique_document_ids),
            )
            .order_by(Document.id)
            .with_for_update(nowait=True)
        ).all()
    unique_segment_ids = tuple(sorted(_unique(segment_ids)))
    if unique_segment_ids:
        session.scalars(
            select(DocumentSegment.id)
            .where(
                DocumentSegment.tenant_id == tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id.in_(unique_document_ids),
                DocumentSegment.id.in_(unique_segment_ids),
            )
            .order_by(DocumentSegment.id)
            .with_for_update(nowait=True)
        ).all()


def remove_document_upload_file_references(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
) -> None:
    unique_document_ids = _unique(document_ids)
    if unique_document_ids:
        candidate_ids = tuple(
            session.scalars(
                select(KnowledgeUploadFileReference.upload_file_id).where(
                    KnowledgeUploadFileReference.tenant_id == tenant_id,
                    KnowledgeUploadFileReference.dataset_id == dataset_id,
                    KnowledgeUploadFileReference.document_id.in_(unique_document_ids),
                )
            ).all()
        )
        _lock_upload_files_for_cleanup(session, tenant_id=tenant_id, file_ids=candidate_ids)
        _lock_knowledge_owners_for_cleanup(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=unique_document_ids,
        )
        session.execute(
            delete(KnowledgeUploadFileReference).where(
                KnowledgeUploadFileReference.tenant_id == tenant_id,
                KnowledgeUploadFileReference.dataset_id == dataset_id,
                KnowledgeUploadFileReference.document_id.in_(unique_document_ids),
            )
        )


def remove_segment_upload_file_references(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    segment_ids: Sequence[str],
) -> None:
    unique_segment_ids = _unique(segment_ids)
    if unique_segment_ids:
        candidate_ids = tuple(
            session.scalars(
                select(KnowledgeUploadFileReference.upload_file_id).where(
                    KnowledgeUploadFileReference.tenant_id == tenant_id,
                    KnowledgeUploadFileReference.dataset_id == dataset_id,
                    KnowledgeUploadFileReference.kind == SEGMENT_IMAGE_REFERENCE,
                    KnowledgeUploadFileReference.resource_id.in_(unique_segment_ids),
                )
            ).all()
        )
        _lock_upload_files_for_cleanup(session, tenant_id=tenant_id, file_ids=candidate_ids)
        document_ids = tuple(
            session.scalars(
                select(DocumentSegment.document_id).where(
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.id.in_(unique_segment_ids),
                )
            ).all()
        )
        _lock_knowledge_owners_for_cleanup(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
            segment_ids=unique_segment_ids,
        )
        session.execute(
            delete(KnowledgeUploadFileReference).where(
                KnowledgeUploadFileReference.tenant_id == tenant_id,
                KnowledgeUploadFileReference.dataset_id == dataset_id,
                KnowledgeUploadFileReference.kind == SEGMENT_IMAGE_REFERENCE,
                KnowledgeUploadFileReference.resource_id.in_(unique_segment_ids),
            )
        )


def add_segment_attachment_bindings(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_id: str,
    attachment_ids: Sequence[str],
) -> None:
    """Validate the complete owner chain and add attachment edges idempotently."""

    unique_attachment_ids = _unique(attachment_ids)
    if not unique_attachment_ids:
        return
    document_exists = session.scalar(
        select(Document.id)
        .where(
            Document.tenant_id == tenant_id,
            Document.dataset_id == dataset_id,
            Document.id == document_id,
        )
        .with_for_update()
    )
    segment_exists = session.scalar(
        select(DocumentSegment.id)
        .where(
            DocumentSegment.tenant_id == tenant_id,
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
            DocumentSegment.id == segment_id,
        )
        .with_for_update()
    )
    if document_exists is None or segment_exists is None:
        raise LookupError("document segment owner chain no longer exists")
    lock_upload_files_for_knowledge_reference(
        session,
        tenant_id=tenant_id,
        file_ids=unique_attachment_ids,
    )
    existing_ids = set(
        session.scalars(
            select(SegmentAttachmentBinding.attachment_id)
            .where(
                SegmentAttachmentBinding.tenant_id == tenant_id,
                SegmentAttachmentBinding.dataset_id == dataset_id,
                SegmentAttachmentBinding.document_id == document_id,
                SegmentAttachmentBinding.segment_id == segment_id,
                SegmentAttachmentBinding.attachment_id.in_(unique_attachment_ids),
            )
            .with_for_update()
        ).all()
    )
    session.add_all(
        SegmentAttachmentBinding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_id=segment_id,
            attachment_id=attachment_id,
        )
        for attachment_id in unique_attachment_ids
        if attachment_id not in existing_ids
    )


def replace_segment_attachment_bindings(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_id: str,
    attachment_ids: Sequence[str],
) -> tuple[UploadFileCleanup, ...]:
    """Replace one segment's attachment edges and return detached file snapshots."""

    dataset_exists = session.scalar(
        select(Dataset.id).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).with_for_update()
    )
    document_exists = session.scalar(
        select(Document.id)
        .where(
            Document.tenant_id == tenant_id,
            Document.dataset_id == dataset_id,
            Document.id == document_id,
        )
        .with_for_update()
    )
    segment_exists = session.scalar(
        select(DocumentSegment.id)
        .where(
            DocumentSegment.tenant_id == tenant_id,
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
            DocumentSegment.id == segment_id,
        )
        .with_for_update()
    )
    if dataset_exists is None or document_exists is None or segment_exists is None:
        raise LookupError("document segment owner chain no longer exists")

    binding_predicates = (
        SegmentAttachmentBinding.tenant_id == tenant_id,
        SegmentAttachmentBinding.dataset_id == dataset_id,
        SegmentAttachmentBinding.document_id == document_id,
        SegmentAttachmentBinding.segment_id == segment_id,
    )
    existing_ids = _unique(
        session.scalars(
            select(SegmentAttachmentBinding.attachment_id)
            .where(*binding_predicates)
            .order_by(SegmentAttachmentBinding.id)
        ).all()
    )
    replacement_ids = _unique(attachment_ids)
    locked_files = lock_upload_files_for_knowledge_reference(
        session,
        tenant_id=tenant_id,
        file_ids=(*existing_ids, *replacement_ids),
    )
    snapshots = {file.id: UploadFileCleanup(id=file.id, key=file.key) for file in locked_files}
    # Lock binding rows after UploadFile to match cleanup's UploadFile -> reference order.
    session.scalars(
        select(SegmentAttachmentBinding.id)
        .where(*binding_predicates)
        .order_by(SegmentAttachmentBinding.id)
        .with_for_update()
    ).all()
    replacement_id_set = set(replacement_ids)
    removed_ids = tuple(file_id for file_id in existing_ids if file_id not in replacement_id_set)
    if removed_ids:
        session.execute(
            delete(SegmentAttachmentBinding).where(
                SegmentAttachmentBinding.tenant_id == tenant_id,
                SegmentAttachmentBinding.dataset_id == dataset_id,
                SegmentAttachmentBinding.document_id == document_id,
                SegmentAttachmentBinding.segment_id == segment_id,
                SegmentAttachmentBinding.attachment_id.in_(removed_ids),
            )
        )
    existing_id_set = set(existing_ids)
    session.add_all(
        SegmentAttachmentBinding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_id=segment_id,
            attachment_id=file_id,
        )
        for file_id in replacement_ids
        if file_id not in existing_id_set
    )
    return tuple(snapshots[file_id] for file_id in removed_ids)


def build_document_cleanup_manifest(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    document_file_ids: Sequence[str],
) -> DocumentCleanupManifest:
    """Snapshot files and bindings before their document rows are deleted."""

    unique_document_ids = _unique(document_ids)
    if not unique_document_ids:
        return DocumentCleanupManifest()

    normalized_references = session.execute(
        select(
            KnowledgeUploadFileReference.kind,
            KnowledgeUploadFileReference.resource_id,
            KnowledgeUploadFileReference.upload_file_id,
        ).where(
            KnowledgeUploadFileReference.tenant_id == tenant_id,
            KnowledgeUploadFileReference.dataset_id == dataset_id,
            KnowledgeUploadFileReference.document_id.in_(unique_document_ids),
            KnowledgeUploadFileReference.kind.in_((DOCUMENT_SOURCE_REFERENCE, SEGMENT_IMAGE_REFERENCE)),
        )
    ).all()
    normalized_source_file_ids = _unique(
        [row.upload_file_id for row in normalized_references if row.kind == DOCUMENT_SOURCE_REFERENCE]
    )
    normalized_image_file_ids = _unique(
        [row.upload_file_id for row in normalized_references if row.kind == SEGMENT_IMAGE_REFERENCE]
    )
    source_documents_with_edges = {
        row.resource_id for row in normalized_references if row.kind == DOCUMENT_SOURCE_REFERENCE
    }
    image_segments_with_edges = {
        row.resource_id for row in normalized_references if row.kind == SEGMENT_IMAGE_REFERENCE
    }

    # Compatibility fallback for rows written before the normalized edge
    # backfill. Current writers persist the edge in the owner transaction.
    documents = session.scalars(
        select(Document).where(
            Document.tenant_id == tenant_id,
            Document.dataset_id == dataset_id,
            Document.id.in_(unique_document_ids),
            Document.id.not_in(source_documents_with_edges),
        )
    ).all()
    fallback_source_file_ids = _unique(
        [
            file_id
            for document in documents
            for file_id in extract_document_source_file_ids(
                document.data_source_type,
                document.data_source_info_dict,
            )
        ]
    )
    segments = session.scalars(
        select(DocumentSegment).where(
            DocumentSegment.tenant_id == tenant_id,
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id.in_(unique_document_ids),
            DocumentSegment.id.not_in(image_segments_with_edges),
        )
    ).all()
    fallback_image_file_ids = _unique(
        [
            image_file_id
            for segment in segments
            for image_file_id in extract_upload_file_ids_from_markdown(segment.content)
        ]
    )
    bindings = session.scalars(
        select(SegmentAttachmentBinding).where(
            SegmentAttachmentBinding.tenant_id == tenant_id,
            SegmentAttachmentBinding.dataset_id == dataset_id,
            SegmentAttachmentBinding.document_id.in_(unique_document_ids),
        )
    ).all()
    attachment_ids = _unique([binding.attachment_id for binding in bindings])
    all_document_file_ids = _unique([*document_file_ids, *normalized_source_file_ids, *fallback_source_file_ids])
    image_file_ids = _unique([*normalized_image_file_ids, *fallback_image_file_ids])
    all_file_ids = _unique([*all_document_file_ids, *image_file_ids, *attachment_ids])
    files = {
        file.id: file
        for file in session.scalars(
            select(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(all_file_ids))
        ).all()
    }
    attachment_id_set = set(attachment_ids)

    def file_snapshot(file_id: str) -> UploadFileCleanup:
        file = files.get(file_id)
        return UploadFileCleanup(id=file_id, key=file.key if file is not None else None)

    return DocumentCleanupManifest(
        document_files=tuple(
            file_snapshot(file_id) for file_id in all_document_file_ids if file_id not in attachment_id_set
        ),
        image_files=tuple(file_snapshot(file_id) for file_id in image_file_ids if file_id not in attachment_id_set),
        segment_attachments=tuple(
            SegmentAttachmentCleanup(
                binding_id=binding.id,
                attachment_id=binding.attachment_id,
                key=files[binding.attachment_id].key if binding.attachment_id in files else None,
            )
            for binding in bindings
        ),
    )


def build_segment_cleanup_manifest(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_ids: Sequence[str],
) -> DocumentCleanupManifest:
    """Snapshot indexed file edges for segments whose owner rows are locked."""

    unique_segment_ids = _unique(segment_ids)
    if not unique_segment_ids:
        return DocumentCleanupManifest()
    normalized_references = session.execute(
        select(
            KnowledgeUploadFileReference.resource_id,
            KnowledgeUploadFileReference.upload_file_id,
        ).where(
            KnowledgeUploadFileReference.tenant_id == tenant_id,
            KnowledgeUploadFileReference.dataset_id == dataset_id,
            KnowledgeUploadFileReference.document_id == document_id,
            KnowledgeUploadFileReference.kind == SEGMENT_IMAGE_REFERENCE,
            KnowledgeUploadFileReference.resource_id.in_(unique_segment_ids),
        )
    ).all()
    normalized_image_file_ids = _unique([row.upload_file_id for row in normalized_references])
    segments_with_edges = {row.resource_id for row in normalized_references}
    legacy_segments = session.execute(
        select(DocumentSegment.id, DocumentSegment.content).where(
            DocumentSegment.tenant_id == tenant_id,
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
            DocumentSegment.id.in_(unique_segment_ids),
            DocumentSegment.id.not_in(segments_with_edges),
        )
    ).all()
    fallback_image_file_ids = _unique(
        [file_id for segment in legacy_segments for file_id in extract_upload_file_ids_from_markdown(segment.content)]
    )
    image_file_ids = _unique([*normalized_image_file_ids, *fallback_image_file_ids])
    bindings = tuple(
        session.scalars(
            select(SegmentAttachmentBinding)
            .where(
                SegmentAttachmentBinding.tenant_id == tenant_id,
                SegmentAttachmentBinding.dataset_id == dataset_id,
                SegmentAttachmentBinding.document_id == document_id,
                SegmentAttachmentBinding.segment_id.in_(unique_segment_ids),
            )
            .order_by(SegmentAttachmentBinding.id)
        ).all()
    )
    attachment_ids = _unique([binding.attachment_id for binding in bindings])
    locked_files = lock_upload_files_for_knowledge_reference(
        session,
        tenant_id=tenant_id,
        file_ids=(*image_file_ids, *attachment_ids),
    )
    files = {file.id: UploadFileCleanup(id=file.id, key=file.key) for file in locked_files}
    attachment_id_set = set(attachment_ids)
    return DocumentCleanupManifest(
        image_files=tuple(files[file_id] for file_id in image_file_ids if file_id not in attachment_id_set),
        segment_attachments=tuple(
            SegmentAttachmentCleanup(
                binding_id=binding.id,
                attachment_id=binding.attachment_id,
                key=files[binding.attachment_id].key,
            )
            for binding in bindings
            if binding.attachment_id in files
        ),
    )


def detach_segment_file_references(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_ids: Sequence[str],
) -> DocumentCleanupManifest:
    """Capture and remove all normalized file edges for locked segments."""

    unique_segment_ids = _unique(segment_ids)
    manifest = build_segment_cleanup_manifest(
        session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_ids=unique_segment_ids,
    )
    if not unique_segment_ids:
        return manifest
    session.execute(
        delete(KnowledgeUploadFileReference).where(
            KnowledgeUploadFileReference.tenant_id == tenant_id,
            KnowledgeUploadFileReference.dataset_id == dataset_id,
            KnowledgeUploadFileReference.document_id == document_id,
            KnowledgeUploadFileReference.kind == SEGMENT_IMAGE_REFERENCE,
            KnowledgeUploadFileReference.resource_id.in_(unique_segment_ids),
        )
    )
    session.execute(
        delete(SegmentAttachmentBinding).where(
            SegmentAttachmentBinding.tenant_id == tenant_id,
            SegmentAttachmentBinding.dataset_id == dataset_id,
            SegmentAttachmentBinding.document_id == document_id,
            SegmentAttachmentBinding.segment_id.in_(unique_segment_ids),
        )
    )
    return manifest


def filter_inline_image_ids_without_active_references(
    session: Session,
    dataset_ref: DatasetRef,
    image_ids: Sequence[str],
    *,
    excluding_segment_ids: Sequence[str] = (),
) -> tuple[str, ...]:
    """Return inline-image vector ids that no other active segment needs."""

    candidates = _unique(image_ids)
    if not candidates:
        return ()
    statement = (
        select(KnowledgeUploadFileReference.upload_file_id)
        .join(
            DocumentSegment,
            (DocumentSegment.tenant_id == KnowledgeUploadFileReference.tenant_id)
            & (DocumentSegment.dataset_id == KnowledgeUploadFileReference.dataset_id)
            & (DocumentSegment.document_id == KnowledgeUploadFileReference.document_id)
            & (DocumentSegment.id == KnowledgeUploadFileReference.resource_id),
        )
        .join(
            Document,
            (Document.tenant_id == DocumentSegment.tenant_id)
            & (Document.dataset_id == DocumentSegment.dataset_id)
            & (Document.id == DocumentSegment.document_id),
        )
        .where(
            KnowledgeUploadFileReference.tenant_id == dataset_ref.tenant_id,
            KnowledgeUploadFileReference.dataset_id == dataset_ref.dataset_id,
            KnowledgeUploadFileReference.kind == SEGMENT_IMAGE_REFERENCE,
            KnowledgeUploadFileReference.upload_file_id.in_(candidates),
            DocumentSegment.enabled.is_(True),
            DocumentSegment.status.in_((SegmentStatus.COMPLETED, SegmentStatus.INDEXING)),
            Document.enabled.is_(True),
            Document.archived.is_(False),
            Document.indexing_status.in_((IndexingStatus.COMPLETED, IndexingStatus.INDEXING)),
        )
        .distinct()
    )
    excluded_ids = _unique(excluding_segment_ids)
    if excluded_ids:
        statement = statement.where(DocumentSegment.id.not_in(excluded_ids))
    referenced = set(session.scalars(statement))
    return tuple(file_id for file_id in candidates if file_id not in referenced)


def remove_stale_knowledge_file_edges(
    session: Session | Connection,
    *,
    tenant_id: str,
    file_ids: Sequence[str],
) -> None:
    """Remove normalized edges whose complete knowledge owner chain is gone."""

    candidate_ids = _unique(file_ids)
    if not candidate_ids:
        return
    document_owner_exists = exists().where(
        Document.tenant_id == KnowledgeUploadFileReference.tenant_id,
        Document.dataset_id == KnowledgeUploadFileReference.dataset_id,
        Document.id == KnowledgeUploadFileReference.document_id,
        Document.id == KnowledgeUploadFileReference.resource_id,
    )
    segment_owner_exists = exists().where(
        DocumentSegment.tenant_id == KnowledgeUploadFileReference.tenant_id,
        DocumentSegment.dataset_id == KnowledgeUploadFileReference.dataset_id,
        DocumentSegment.document_id == KnowledgeUploadFileReference.document_id,
        DocumentSegment.id == KnowledgeUploadFileReference.resource_id,
    )
    session.execute(
        delete(KnowledgeUploadFileReference).where(
            KnowledgeUploadFileReference.tenant_id == tenant_id,
            KnowledgeUploadFileReference.upload_file_id.in_(candidate_ids),
            or_(
                (KnowledgeUploadFileReference.kind == DOCUMENT_SOURCE_REFERENCE) & ~document_owner_exists,
                (KnowledgeUploadFileReference.kind == SEGMENT_IMAGE_REFERENCE) & ~segment_owner_exists,
            ),
        )
    )
    binding_owner_exists = exists().where(
        DocumentSegment.tenant_id == SegmentAttachmentBinding.tenant_id,
        DocumentSegment.dataset_id == SegmentAttachmentBinding.dataset_id,
        DocumentSegment.document_id == SegmentAttachmentBinding.document_id,
        DocumentSegment.id == SegmentAttachmentBinding.segment_id,
    )
    session.execute(
        delete(SegmentAttachmentBinding).where(
            SegmentAttachmentBinding.tenant_id == tenant_id,
            SegmentAttachmentBinding.attachment_id.in_(candidate_ids),
            ~binding_owner_exists,
        )
    )
    draft_variable_owner_exists = exists().where(
        WorkflowDraftVariable.id == WorkflowDraftVariableUploadFileReference.draft_variable_id,
        WorkflowDraftVariable.app_id == WorkflowDraftVariableUploadFileReference.app_id,
        WorkflowDraftVariable.node_id == WorkflowDraftVariableUploadFileReference.node_id,
    )
    workflow_owner_exists = exists().where(
        Workflow.tenant_id == WorkflowDraftVariableUploadFileReference.tenant_id,
        Workflow.app_id == WorkflowDraftVariableUploadFileReference.app_id,
    )
    session.execute(
        delete(WorkflowDraftVariableUploadFileReference).where(
            WorkflowDraftVariableUploadFileReference.tenant_id == tenant_id,
            WorkflowDraftVariableUploadFileReference.upload_file_id.in_(candidate_ids),
            or_(~draft_variable_owner_exists, ~workflow_owner_exists),
        )
    )
    agent_config_draft_exists = exists().where(
        AgentConfigDraft.tenant_id == AgentConfigUploadFileReference.tenant_id,
        AgentConfigDraft.id == AgentConfigUploadFileReference.owner_id,
    )
    agent_config_snapshot_exists = exists().where(
        AgentConfigSnapshot.tenant_id == AgentConfigUploadFileReference.tenant_id,
        AgentConfigSnapshot.id == AgentConfigUploadFileReference.owner_id,
    )
    session.execute(
        delete(AgentConfigUploadFileReference).where(
            AgentConfigUploadFileReference.tenant_id == tenant_id,
            AgentConfigUploadFileReference.upload_file_id.in_(candidate_ids),
            or_(
                (AgentConfigUploadFileReference.owner_kind == AGENT_CONFIG_DRAFT_REFERENCE)
                & ~agent_config_draft_exists,
                (AgentConfigUploadFileReference.owner_kind == AGENT_CONFIG_SNAPSHOT_REFERENCE)
                & ~agent_config_snapshot_exists,
                AgentConfigUploadFileReference.owner_kind.not_in(
                    (AGENT_CONFIG_DRAFT_REFERENCE, AGENT_CONFIG_SNAPSHOT_REFERENCE)
                ),
            ),
        )
    )
    if isinstance(session, Session):
        session.flush()


def _candidate_serialized_reference_predicate(
    column: ColumnElement[Any] | InstrumentedAttribute[Any],
    candidate_ids: Sequence[str],
) -> ColumnElement[bool]:
    def canonical_prefix(file_id: str) -> str:
        payload_prefix = json.dumps({"record_id": file_id}, separators=(",", ":")).removesuffix("}").encode()
        complete_group_length = len(payload_prefix) // 3 * 3
        encoded_prefix = base64.urlsafe_b64encode(payload_prefix[:complete_group_length]).decode()
        return f"dify-file-ref:{encoded_prefix}"

    search_terms = tuple(
        dict.fromkeys(
            term
            for file_id in candidate_ids
            for term in (file_id, build_file_reference(record_id=file_id), canonical_prefix(file_id))
        )
    )
    return or_(*(column.like(f"%{term}%") for term in search_terms))


def _serialized_upload_file_references(
    session: Session | Connection,
    *,
    tenant_id: str,
    candidate_ids: Sequence[str],
    excluding_dataset_ids: Sequence[str],
) -> set[str]:
    """Read only candidate-matching legacy fields during mixed-version rollout.

    Older workers do not maintain normalized reference rows. Keep their
    already-committed writes visible to both cleanup phases without restoring
    the former tenant-wide Python scan.
    """

    candidates = set(candidate_ids)
    referenced_ids: set[str] = set()
    document_statement = (
        select(
            Document.data_source_type,
            Document.data_source_info,
        )
        .join(
            Dataset,
            (Dataset.tenant_id == Document.tenant_id) & (Dataset.id == Document.dataset_id),
        )
        .where(
            Dataset.tenant_id == tenant_id,
            Document.tenant_id == tenant_id,
            Document.data_source_type.in_((DataSourceType.UPLOAD_FILE, DataSourceType.LOCAL_FILE)),
            _candidate_serialized_reference_predicate(Document.data_source_info, candidate_ids),
        )
    )
    segment_statement = (
        select(DocumentSegment.content)
        .join(
            Document,
            (Document.tenant_id == DocumentSegment.tenant_id)
            & (Document.dataset_id == DocumentSegment.dataset_id)
            & (Document.id == DocumentSegment.document_id),
        )
        .join(
            Dataset,
            (Dataset.tenant_id == DocumentSegment.tenant_id) & (Dataset.id == DocumentSegment.dataset_id),
        )
        .where(
            Dataset.tenant_id == tenant_id,
            Document.tenant_id == tenant_id,
            DocumentSegment.tenant_id == tenant_id,
            _candidate_serialized_reference_predicate(DocumentSegment.content, candidate_ids),
        )
    )
    if excluding_dataset_ids:
        document_statement = document_statement.where(Document.dataset_id.not_in(excluding_dataset_ids))
        segment_statement = segment_statement.where(DocumentSegment.dataset_id.not_in(excluding_dataset_ids))
    document_rows = session.execute(document_statement.with_for_update(nowait=True)).all()
    for source_type, raw_info in document_rows:
        if not isinstance(raw_info, str):
            continue
        try:
            source_info = json.loads(raw_info)
        except (TypeError, ValueError):
            continue
        if not isinstance(source_info, Mapping):
            continue
        referenced_ids.update(
            file_id for file_id in extract_document_source_file_ids(source_type, source_info) if file_id in candidates
        )
    for content in session.scalars(segment_statement.with_for_update(nowait=True)).all():
        referenced_ids.update(
            file_id for file_id in extract_upload_file_ids_from_markdown(content) if file_id in candidates
        )

    workflow_rows = session.execute(
        select(WorkflowDraftVariable.value_type, WorkflowDraftVariable.value)
        .join(Workflow, Workflow.app_id == WorkflowDraftVariable.app_id)
        .where(
            Workflow.tenant_id == tenant_id,
            WorkflowDraftVariable.value_type.in_(("file", "array[file]")),
            _candidate_serialized_reference_predicate(WorkflowDraftVariable.value, candidate_ids),
        )
        .with_for_update(nowait=True)
    ).all()
    for value_type, value in workflow_rows:
        referenced_ids.update(
            file_id
            for file_id in resolve_upload_file_ids_from_serialized_file_value(
                value_type=value_type,
                value=value,
            )
            if file_id in candidates
        )
    for model in (AgentConfigDraft, AgentConfigSnapshot):
        configs = session.scalars(
            select(model.config_snapshot)
            .where(
                model.tenant_id == tenant_id,
                _candidate_serialized_reference_predicate(cast(model.config_snapshot, String), candidate_ids),
            )
            .with_for_update(nowait=True)
        ).all()
        referenced_ids.update(
            file_id
            for config_snapshot in configs
            for file_id in extract_agent_config_upload_file_ids(config_snapshot)
            if file_id in candidates
        )
    return referenced_ids


def find_orphan_upload_files(
    session: Session | Connection,
    *,
    tenant_id: str,
    files: Sequence[UploadFileCleanup],
    excluding_dataset_ids: Sequence[str] = (),
    excluding_message_app_id: str | None = None,
    excluding_workflow_offload_ids: Sequence[str] = (),
    excluding_workflow_draft_file_ids: Sequence[str] = (),
) -> tuple[UploadFileCleanup, ...]:
    """Return candidates with no durable reference in any owning domain."""

    candidates = {file.id: file for file in files}
    if not candidates:
        return ()
    if len(candidates) > _REFERENCE_SCAN_BATCH_SIZE:
        orphan_ids: set[str] = set()
        ordered_candidates = tuple(sorted(candidates.values(), key=lambda file: file.id))
        for candidate_batch in batched(ordered_candidates, _REFERENCE_SCAN_BATCH_SIZE, strict=False):
            orphan_ids.update(
                file.id
                for file in find_orphan_upload_files(
                    session,
                    tenant_id=tenant_id,
                    files=candidate_batch,
                    excluding_dataset_ids=excluding_dataset_ids,
                    excluding_message_app_id=excluding_message_app_id,
                    excluding_workflow_offload_ids=excluding_workflow_offload_ids,
                    excluding_workflow_draft_file_ids=excluding_workflow_draft_file_ids,
                )
            )
        return tuple(file for file_id, file in candidates.items() if file_id in orphan_ids)
    candidate_ids = tuple(candidates)
    binding_statement = select(SegmentAttachmentBinding.attachment_id).where(
        SegmentAttachmentBinding.tenant_id == tenant_id,
        SegmentAttachmentBinding.attachment_id.in_(candidate_ids),
    )
    if excluding_dataset_ids:
        binding_statement = binding_statement.where(SegmentAttachmentBinding.dataset_id.not_in(excluding_dataset_ids))
    binding_statement = binding_statement.with_for_update(nowait=True)
    referenced_ids = set(session.scalars(binding_statement).all())
    reference_statement = select(KnowledgeUploadFileReference.upload_file_id).where(
        KnowledgeUploadFileReference.tenant_id == tenant_id,
        KnowledgeUploadFileReference.upload_file_id.in_(candidate_ids),
    )
    if excluding_dataset_ids:
        reference_statement = reference_statement.where(
            KnowledgeUploadFileReference.dataset_id.not_in(excluding_dataset_ids)
        )
    reference_statement = reference_statement.with_for_update(nowait=True)
    referenced_ids.update(session.scalars(reference_statement).all())

    referenced_ids.update(
        session.scalars(
            select(WorkflowDraftVariableUploadFileReference.upload_file_id)
            .join(
                WorkflowDraftVariable,
                (WorkflowDraftVariable.id == WorkflowDraftVariableUploadFileReference.draft_variable_id)
                & (WorkflowDraftVariable.app_id == WorkflowDraftVariableUploadFileReference.app_id)
                & (WorkflowDraftVariable.node_id == WorkflowDraftVariableUploadFileReference.node_id),
            )
            .join(
                Workflow,
                (Workflow.tenant_id == WorkflowDraftVariableUploadFileReference.tenant_id)
                & (Workflow.app_id == WorkflowDraftVariableUploadFileReference.app_id),
            )
            .where(
                WorkflowDraftVariableUploadFileReference.tenant_id == tenant_id,
                WorkflowDraftVariableUploadFileReference.upload_file_id.in_(candidate_ids),
            )
            .with_for_update(nowait=True)
        ).all()
    )
    referenced_ids.update(
        session.scalars(
            select(AgentConfigUploadFileReference.upload_file_id)
            .where(
                AgentConfigUploadFileReference.tenant_id == tenant_id,
                AgentConfigUploadFileReference.upload_file_id.in_(candidate_ids),
                or_(
                    (AgentConfigUploadFileReference.owner_kind == AGENT_CONFIG_DRAFT_REFERENCE)
                    & exists().where(
                        AgentConfigDraft.tenant_id == AgentConfigUploadFileReference.tenant_id,
                        AgentConfigDraft.id == AgentConfigUploadFileReference.owner_id,
                    ),
                    (AgentConfigUploadFileReference.owner_kind == AGENT_CONFIG_SNAPSHOT_REFERENCE)
                    & exists().where(
                        AgentConfigSnapshot.tenant_id == AgentConfigUploadFileReference.tenant_id,
                        AgentConfigSnapshot.id == AgentConfigUploadFileReference.owner_id,
                    ),
                ),
            )
            .with_for_update(nowait=True)
        ).all()
    )
    referenced_ids.update(
        _serialized_upload_file_references(
            session,
            tenant_id=tenant_id,
            candidate_ids=candidate_ids,
            excluding_dataset_ids=excluding_dataset_ids,
        )
    )

    app_icon_predicates = [App.icon.in_(candidate_ids)]
    for file_id in candidate_ids:
        app_icon_predicates.extend(
            (
                App.icon.like(f"%/files/{file_id}/file-preview%"),
                App.icon.like(f"%/files/{file_id}/image-preview%"),
            )
        )
    app_icons = session.scalars(
        select(App.icon)
        .where(
            App.tenant_id == tenant_id,
            App.icon_type == IconType.IMAGE,
            or_(*app_icon_predicates),
        )
        .with_for_update(nowait=True)
    ).all()
    referenced_ids.update(
        file_id
        for icon in app_icons
        if (file_id := extract_app_icon_upload_file_id(IconType.IMAGE, icon)) in candidates
    )

    site_icon_predicates = [Site.icon.in_(candidate_ids)]
    for file_id in candidate_ids:
        site_icon_predicates.extend(
            (
                Site.icon.like(f"%/files/{file_id}/file-preview%"),
                Site.icon.like(f"%/files/{file_id}/image-preview%"),
            )
        )
    site_icons = session.scalars(
        select(Site.icon)
        .join(App, App.id == Site.app_id)
        .where(
            App.tenant_id == tenant_id,
            Site.icon_type == IconType.IMAGE,
            or_(*site_icon_predicates),
        )
        .with_for_update(of=Site, nowait=True)
    ).all()
    referenced_ids.update(
        file_id
        for icon in site_icons
        if (file_id := extract_app_icon_upload_file_id(IconType.IMAGE, icon)) in candidates
    )

    account_avatars = session.scalars(
        select(Account.avatar)
        .join(
            UploadFile,
            (cast(UploadFile.id, String) == Account.avatar)
            & (UploadFile.tenant_id == tenant_id)
            & (UploadFile.created_by_role == CreatorUserRole.ACCOUNT)
            & (UploadFile.created_by == Account.id),
        )
        .where(
            Account.avatar.in_(candidate_ids),
            UploadFile.id.in_(candidate_ids),
        )
        .with_for_update(of=Account, nowait=True)
    ).all()
    referenced_ids.update(
        file_id
        for avatar in account_avatars
        if (file_id := extract_account_avatar_upload_file_id(avatar)) in candidates
    )

    tenant_config = session.scalar(
        select(Tenant.custom_config)
        .where(
            Tenant.id == tenant_id,
            or_(*(Tenant.custom_config.like(f"%{file_id}%") for file_id in candidate_ids)),
        )
        .with_for_update(nowait=True)
    )
    tenant_logo_id = extract_tenant_logo_upload_file_id(tenant_config)
    if tenant_logo_id in candidates:
        referenced_ids.add(tenant_logo_id)

    dataset_icons = session.scalars(
        select(Dataset.icon_info)
        .where(
            Dataset.tenant_id == tenant_id,
            or_(*(cast(Dataset.icon_info, String).like(f"%{file_id}%") for file_id in candidate_ids)),
        )
        .with_for_update(nowait=True)
    ).all()
    referenced_ids.update(
        file_id for icon_info in dataset_icons if (file_id := extract_icon_info_upload_file_id(icon_info)) in candidates
    )

    template_icons = session.scalars(
        select(PipelineCustomizedTemplate.icon)
        .where(
            PipelineCustomizedTemplate.tenant_id == tenant_id,
            or_(*(cast(PipelineCustomizedTemplate.icon, String).like(f"%{file_id}%") for file_id in candidate_ids)),
        )
        .with_for_update(nowait=True)
    ).all()
    referenced_ids.update(
        file_id
        for icon_info in template_icons
        if (file_id := extract_icon_info_upload_file_id(icon_info)) in candidates
    )

    agent_icons = session.execute(
        select(Agent.icon_type, Agent.icon)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.icon_type == AgentIconType.IMAGE,
            or_(
                Agent.icon.in_(candidate_ids),
                *(Agent.icon.like(f"%/files/{file_id}/%preview%") for file_id in candidate_ids),
            ),
        )
        .with_for_update(nowait=True)
    ).all()
    referenced_ids.update(
        file_id
        for icon_type, icon in agent_icons
        if (file_id := extract_agent_icon_upload_file_id(icon_type, icon)) in candidates
    )

    snippet_icons = session.scalars(
        select(CustomizedSnippet.icon_info)
        .where(
            CustomizedSnippet.tenant_id == tenant_id,
            or_(*(cast(CustomizedSnippet.icon_info, String).like(f"%{file_id}%") for file_id in candidate_ids)),
        )
        .with_for_update(nowait=True)
    ).all()
    referenced_ids.update(
        file_id for icon_info in snippet_icons if (file_id := extract_icon_info_upload_file_id(icon_info)) in candidates
    )

    mcp_icons = session.scalars(
        select(MCPToolProvider.icon)
        .where(
            MCPToolProvider.tenant_id == tenant_id,
            or_(
                MCPToolProvider.icon.in_(candidate_ids),
                *(MCPToolProvider.icon.like(f"%/files/{file_id}/%preview%") for file_id in candidate_ids),
            ),
        )
        .with_for_update(nowait=True)
    ).all()
    referenced_ids.update(
        file_id for icon in mcp_icons if (file_id := extract_mcp_icon_upload_file_id(icon)) in candidates
    )

    if excluding_message_app_id is None:
        message_statement = select(MessageFile.upload_file_id).where(
            MessageFile.upload_file_id.in_(candidate_ids),
            MessageFile.upload_file_id.is_not(None),
        )
    else:
        message_statement = (
            select(MessageFile.upload_file_id)
            .join(Message, Message.id == MessageFile.message_id)
            .where(
                MessageFile.upload_file_id.in_(candidate_ids),
                MessageFile.upload_file_id.is_not(None),
                Message.app_id != excluding_message_app_id,
            )
        )
        orphan_message_statement = (
            select(MessageFile.upload_file_id)
            .where(
                MessageFile.upload_file_id.in_(candidate_ids),
                MessageFile.upload_file_id.is_not(None),
                ~exists().where(Message.id == MessageFile.message_id),
            )
            .with_for_update(nowait=True)
        )
        referenced_ids.update(file_id for file_id in session.scalars(orphan_message_statement).all() if file_id)
    referenced_ids.update(
        file_id for file_id in session.scalars(message_statement.with_for_update(nowait=True)).all() if file_id
    )

    offload_statement = select(WorkflowNodeExecutionOffload.file_id).where(
        WorkflowNodeExecutionOffload.tenant_id == tenant_id,
        WorkflowNodeExecutionOffload.file_id.in_(candidate_ids),
    )
    unique_excluded_offload_ids = _unique(excluding_workflow_offload_ids)
    if unique_excluded_offload_ids:
        offload_statement = offload_statement.where(WorkflowNodeExecutionOffload.id.not_in(unique_excluded_offload_ids))
    referenced_ids.update(session.scalars(offload_statement.with_for_update(nowait=True)).all())
    draft_file_statement = select(WorkflowDraftVariableFile.upload_file_id).where(
        WorkflowDraftVariableFile.tenant_id == tenant_id,
        WorkflowDraftVariableFile.upload_file_id.in_(candidate_ids),
    )
    unique_excluded_draft_file_ids = _unique(excluding_workflow_draft_file_ids)
    if unique_excluded_draft_file_ids:
        draft_file_statement = draft_file_statement.where(
            WorkflowDraftVariableFile.id.not_in(unique_excluded_draft_file_ids)
        )
    referenced_ids.update(session.scalars(draft_file_statement.with_for_update(nowait=True)).all())
    referenced_ids.update(
        session.scalars(
            select(HumanInputFormUploadFile.upload_file_id)
            .where(
                HumanInputFormUploadFile.tenant_id == tenant_id,
                HumanInputFormUploadFile.upload_file_id.in_(candidate_ids),
            )
            .with_for_update(nowait=True)
        ).all()
    )
    return tuple(file for file_id, file in candidates.items() if file_id not in referenced_ids)


def detach_orphan_segment_attachments(
    session: Session,
    *,
    tenant_id: str,
    attachments: Sequence[SegmentAttachmentCleanup],
) -> tuple[UploadFileCleanup, ...]:
    """Delete selected bindings and return their candidate files."""

    binding_ids = _unique([attachment.binding_id for attachment in attachments])
    candidates = {attachment.attachment_id: attachment.file for attachment in attachments}
    if binding_ids:
        _lock_upload_files_for_cleanup(session, tenant_id=tenant_id, file_ids=tuple(candidates))
        session.execute(
            delete(SegmentAttachmentBinding).where(
                SegmentAttachmentBinding.tenant_id == tenant_id,
                SegmentAttachmentBinding.id.in_(binding_ids),
            )
        )
        session.flush()
    return tuple(candidates.values())


def detach_segment_attachments_and_claim_files(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_ids: Sequence[str] = (),
) -> tuple[UploadFileCleanup, ...]:
    """Detach scoped attachment edges and fence newly orphaned file rows."""

    statement = select(SegmentAttachmentBinding).where(
        SegmentAttachmentBinding.tenant_id == tenant_id,
        SegmentAttachmentBinding.dataset_id == dataset_id,
        SegmentAttachmentBinding.document_id == document_id,
    )
    if segment_ids:
        statement = statement.where(SegmentAttachmentBinding.segment_id.in_(_unique(segment_ids)))
    bindings = tuple(session.scalars(statement.order_by(SegmentAttachmentBinding.id)).all())
    if not bindings:
        return ()
    candidates = tuple(
        UploadFileCleanup(id=attachment_id, key=None)
        for attachment_id in _unique([binding.attachment_id for binding in bindings])
    )
    _lock_upload_files_for_cleanup(
        session,
        tenant_id=tenant_id,
        file_ids=tuple(file.id for file in candidates),
    )
    session.execute(
        delete(SegmentAttachmentBinding).where(
            SegmentAttachmentBinding.tenant_id == tenant_id,
            SegmentAttachmentBinding.id.in_(tuple(binding.id for binding in bindings)),
        )
    )
    return claim_orphan_upload_files(
        session,
        tenant_id=tenant_id,
        files=candidates,
    )


def claim_orphan_upload_files(
    session: Session,
    *,
    tenant_id: str,
    files: Sequence[UploadFileCleanup],
    excluding_dataset_ids: Sequence[str] = (),
    excluding_message_app_id: str | None = None,
    excluding_workflow_offload_ids: Sequence[str] = (),
    excluding_workflow_draft_file_ids: Sequence[str] = (),
) -> tuple[UploadFileCleanup, ...]:
    """Fence orphan candidates against new references before storage deletion."""

    candidates = {file.id: file for file in files}
    if not candidates:
        return ()
    locked_files = tuple(
        file
        for candidate_batch in batched(tuple(sorted(candidates)), _REFERENCE_SCAN_BATCH_SIZE, strict=False)
        for file in session.scalars(
            select(UploadFile)
            .where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(candidate_batch))
            .order_by(UploadFile.id)
            .with_for_update()
        ).all()
    )
    locked_by_id = {file.id: UploadFileCleanup(id=file.id, key=file.key) for file in locked_files}
    locked_snapshots = tuple(locked_by_id.values())
    for candidate_batch in batched(tuple(locked_by_id), _REFERENCE_SCAN_BATCH_SIZE, strict=False):
        remove_stale_knowledge_file_edges(session, tenant_id=tenant_id, file_ids=candidate_batch)
    orphan_files = find_orphan_upload_files(
        session,
        tenant_id=tenant_id,
        files=locked_snapshots,
        excluding_dataset_ids=excluding_dataset_ids,
        excluding_message_app_id=excluding_message_app_id,
        excluding_workflow_offload_ids=excluding_workflow_offload_ids,
        excluding_workflow_draft_file_ids=excluding_workflow_draft_file_ids,
    )
    orphan_ids = {file.id for file in orphan_files}
    claimed_at = datetime.now(UTC).replace(tzinfo=None)
    for file in locked_files:
        if file.id in orphan_ids:
            if file.knowledge_cleanup_started_at is None:
                file.knowledge_cleanup_started_at = claimed_at
        elif file.knowledge_cleanup_started_at is not None:
            file.knowledge_cleanup_started_at = None
    session.flush()
    return tuple(locked_by_id[file_id] for file_id in candidates if file_id in orphan_ids)


def recheck_claimed_orphan_upload_files(
    session: Session,
    *,
    tenant_id: str,
    files: Sequence[UploadFileCleanup],
    excluding_dataset_ids: Sequence[str] = (),
    excluding_message_app_id: str | None = None,
    excluding_workflow_offload_ids: Sequence[str] = (),
    excluding_workflow_draft_file_ids: Sequence[str] = (),
) -> tuple[UploadFileCleanup, ...]:
    """Revalidate cleanup claims immediately before deleting storage objects.

    This second current read protects rolling upgrades where an older worker can
    persist a supported reference without maintaining its normalized edge after
    the initial claim. Files referenced since that claim are released for normal
    use and omitted from the returned deletion set.
    """

    requested_ids = _unique([file.id for file in files])
    if not requested_ids:
        return ()
    candidate_ids = tuple(sorted(requested_ids))
    locked_files = tuple(
        file
        for candidate_batch in batched(candidate_ids, _REFERENCE_SCAN_BATCH_SIZE, strict=False)
        for file in session.scalars(
            select(UploadFile)
            .where(
                UploadFile.tenant_id == tenant_id,
                UploadFile.id.in_(candidate_batch),
                UploadFile.knowledge_cleanup_started_at.is_not(None),
            )
            .order_by(UploadFile.id)
            .with_for_update()
        ).all()
    )
    snapshots_by_id = {file.id: UploadFileCleanup(id=file.id, key=file.key) for file in locked_files}
    snapshots = tuple(snapshots_by_id.values())
    for candidate_batch in batched(candidate_ids, _REFERENCE_SCAN_BATCH_SIZE, strict=False):
        remove_stale_knowledge_file_edges(session, tenant_id=tenant_id, file_ids=candidate_batch)
    orphan_ids = {
        file.id
        for file in find_orphan_upload_files(
            session,
            tenant_id=tenant_id,
            files=snapshots,
            excluding_dataset_ids=excluding_dataset_ids,
            excluding_message_app_id=excluding_message_app_id,
            excluding_workflow_offload_ids=excluding_workflow_offload_ids,
            excluding_workflow_draft_file_ids=excluding_workflow_draft_file_ids,
        )
    }
    for file in locked_files:
        if file.id not in orphan_ids:
            file.knowledge_cleanup_started_at = None
    session.flush()
    return tuple(snapshots_by_id[file_id] for file_id in requested_ids if file_id in orphan_ids)


def detach_workflow_draft_variable_files_and_claim_uploads(
    session: Session,
    *,
    tenant_id: str,
    draft_file_ids: Sequence[str],
) -> tuple[UploadFileCleanup, ...]:
    """Detach large draft-value owners and durably fence orphaned uploads.

    The caller owns the surrounding transaction. Object storage cleanup is
    intentionally left to the bounded claimed-file recovery worker after that
    transaction commits.
    """

    unique_owner_ids = tuple(sorted(_unique(draft_file_ids)))
    if not unique_owner_ids:
        return ()
    candidate_owner_rows = tuple(
        session.execute(
            select(WorkflowDraftVariableFile.id, WorkflowDraftVariableFile.upload_file_id).where(
                WorkflowDraftVariableFile.tenant_id == tenant_id,
                WorkflowDraftVariableFile.id.in_(unique_owner_ids),
            )
        ).all()
    )
    _lock_upload_files_for_cleanup(
        session,
        tenant_id=tenant_id,
        file_ids=tuple(row.upload_file_id for row in candidate_owner_rows),
    )
    owners = tuple(
        session.scalars(
            select(WorkflowDraftVariableFile)
            .where(
                WorkflowDraftVariableFile.tenant_id == tenant_id,
                WorkflowDraftVariableFile.id.in_(unique_owner_ids),
            )
            .order_by(WorkflowDraftVariableFile.id)
            .with_for_update(nowait=True)
        ).all()
    )
    _lock_upload_files_for_cleanup(
        session,
        tenant_id=tenant_id,
        file_ids=tuple(owner.upload_file_id for owner in owners),
        nowait=True,
    )
    candidates = tuple(
        UploadFileCleanup(id=upload_file_id, key=None)
        for upload_file_id in _unique([owner.upload_file_id for owner in owners])
    )
    if owners:
        session.execute(
            delete(WorkflowDraftVariableFile).where(
                WorkflowDraftVariableFile.tenant_id == tenant_id,
                WorkflowDraftVariableFile.id.in_(tuple(owner.id for owner in owners)),
            )
        )
        session.flush()
    return claim_orphan_upload_files(
        session,
        tenant_id=tenant_id,
        files=candidates,
    )


def detach_agent_config_versions_and_claim_uploads(
    session: Session,
    *,
    tenant_id: str,
    agent_ids: Sequence[str],
) -> tuple[UploadFileCleanup, ...]:
    """Delete Agent config owners and retain their UploadFile cleanup candidates."""

    unique_agent_ids = tuple(sorted(_unique(agent_ids)))
    if not unique_agent_ids:
        return ()

    initial_drafts = tuple(
        session.execute(
            select(AgentConfigDraft.id, AgentConfigDraft.config_snapshot)
            .where(
                AgentConfigDraft.tenant_id == tenant_id,
                AgentConfigDraft.agent_id.in_(unique_agent_ids),
            )
            .order_by(AgentConfigDraft.id)
        ).all()
    )
    initial_snapshots = tuple(
        session.execute(
            select(AgentConfigSnapshot.id, AgentConfigSnapshot.config_snapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id.in_(unique_agent_ids),
            )
            .order_by(AgentConfigSnapshot.id)
        ).all()
    )
    candidate_ids = tuple(
        sorted(
            {
                file_id
                for row in (*initial_drafts, *initial_snapshots)
                for file_id in extract_agent_config_upload_file_ids(row.config_snapshot)
            }
        )
    )
    locked_uploads = _lock_upload_files_for_cleanup(
        session,
        tenant_id=tenant_id,
        file_ids=candidate_ids,
    )
    tool_candidate_ids = tuple(
        sorted(
            {
                file_id
                for row in (*initial_drafts, *initial_snapshots)
                for file_id in extract_agent_config_tool_file_ids(row.config_snapshot)
            }
        )
    )
    locked_tool_files = tuple(
        AgentConfigToolFileCleanup(id=row.id, key=row.file_key)
        for row in session.execute(
            select(ToolFile.id, ToolFile.file_key)
            .where(ToolFile.tenant_id == tenant_id, ToolFile.id.in_(tool_candidate_ids))
            .order_by(ToolFile.id)
            .with_for_update(of=ToolFile)
        ).all()
    )
    locked_agent_ids = tuple(
        session.scalars(
            select(Agent.id)
            .where(Agent.tenant_id == tenant_id, Agent.id.in_(unique_agent_ids))
            .order_by(Agent.id)
            .with_for_update(nowait=True)
        ).all()
    )
    if locked_agent_ids != unique_agent_ids:
        raise LookupError("Agent config owner changed while its upload references were being fenced")

    locked_drafts = tuple(
        session.execute(
            select(AgentConfigDraft.id, AgentConfigDraft.config_snapshot)
            .where(
                AgentConfigDraft.tenant_id == tenant_id,
                AgentConfigDraft.agent_id.in_(unique_agent_ids),
            )
            .order_by(AgentConfigDraft.id)
            .with_for_update(nowait=True)
        ).all()
    )
    locked_snapshots = tuple(
        session.execute(
            select(AgentConfigSnapshot.id, AgentConfigSnapshot.config_snapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id.in_(unique_agent_ids),
            )
            .order_by(AgentConfigSnapshot.id)
            .with_for_update(nowait=True)
        ).all()
    )
    initial_state = tuple(
        (
            row.id,
            extract_agent_config_upload_file_ids(row.config_snapshot),
            extract_agent_config_tool_file_ids(row.config_snapshot),
        )
        for row in (*initial_drafts, *initial_snapshots)
    )
    locked_state = tuple(
        (
            row.id,
            extract_agent_config_upload_file_ids(row.config_snapshot),
            extract_agent_config_tool_file_ids(row.config_snapshot),
        )
        for row in (*locked_drafts, *locked_snapshots)
    )
    if locked_state != initial_state:
        raise RuntimeError("Agent config changed while its upload references were being fenced")

    draft_ids = tuple(row.id for row in locked_drafts)
    snapshot_ids = tuple(row.id for row in locked_snapshots)
    owner_predicates: list[ColumnElement[bool]] = []
    tool_owner_predicates: list[ColumnElement[bool]] = []
    if draft_ids:
        owner_predicates.append(
            (AgentConfigUploadFileReference.owner_kind == AGENT_CONFIG_DRAFT_REFERENCE)
            & AgentConfigUploadFileReference.owner_id.in_(draft_ids)
        )
        tool_owner_predicates.append(
            (AgentConfigToolFileReference.owner_kind == AGENT_CONFIG_DRAFT_REFERENCE)
            & AgentConfigToolFileReference.owner_id.in_(draft_ids)
        )
    if snapshot_ids:
        owner_predicates.append(
            (AgentConfigUploadFileReference.owner_kind == AGENT_CONFIG_SNAPSHOT_REFERENCE)
            & AgentConfigUploadFileReference.owner_id.in_(snapshot_ids)
        )
        tool_owner_predicates.append(
            (AgentConfigToolFileReference.owner_kind == AGENT_CONFIG_SNAPSHOT_REFERENCE)
            & AgentConfigToolFileReference.owner_id.in_(snapshot_ids)
        )
    if owner_predicates:
        session.execute(
            delete(AgentConfigUploadFileReference).where(
                AgentConfigUploadFileReference.tenant_id == tenant_id,
                or_(*owner_predicates),
            )
        )
    if tool_owner_predicates:
        session.execute(
            delete(AgentConfigToolFileReference).where(
                AgentConfigToolFileReference.tenant_id == tenant_id,
                or_(*tool_owner_predicates),
            )
        )
    if draft_ids:
        session.execute(delete(AgentConfigDraft).where(AgentConfigDraft.id.in_(draft_ids)))
    if snapshot_ids:
        session.execute(delete(AgentConfigSnapshot).where(AgentConfigSnapshot.id.in_(snapshot_ids)))
    session.flush()
    claim_orphan_agent_config_tool_files(
        session,
        tenant_id=tenant_id,
        files=locked_tool_files,
    )
    return claim_orphan_upload_files(
        session,
        tenant_id=tenant_id,
        files=tuple(UploadFileCleanup(id=file.id, key=file.key) for file in locked_uploads),
    )


def detach_workflow_node_execution_offloads_and_claim_uploads(
    session: Session,
    *,
    tenant_id: str,
    offload_ids: Sequence[str],
) -> tuple[UploadFileCleanup, ...]:
    """Detach node-execution offloads and persist their orphan cleanup claim."""

    unique_owner_ids = tuple(sorted(_unique(offload_ids)))
    if not unique_owner_ids:
        return ()
    candidate_owner_rows = tuple(
        session.execute(
            select(WorkflowNodeExecutionOffload.id, WorkflowNodeExecutionOffload.file_id).where(
                WorkflowNodeExecutionOffload.tenant_id == tenant_id,
                WorkflowNodeExecutionOffload.id.in_(unique_owner_ids),
            )
        ).all()
    )
    locked_files = list(
        _lock_upload_files_for_cleanup(
            session,
            tenant_id=tenant_id,
            file_ids=tuple(row.file_id for row in candidate_owner_rows),
        )
    )
    owners = tuple(
        session.scalars(
            select(WorkflowNodeExecutionOffload)
            .where(
                WorkflowNodeExecutionOffload.tenant_id == tenant_id,
                WorkflowNodeExecutionOffload.id.in_(unique_owner_ids),
            )
            .order_by(WorkflowNodeExecutionOffload.id)
            .with_for_update(nowait=True)
        ).all()
    )
    locked_ids = {file.id for file in locked_files}
    locked_files.extend(
        _lock_upload_files_for_cleanup(
            session,
            tenant_id=tenant_id,
            file_ids=tuple(owner.file_id for owner in owners if owner.file_id not in locked_ids),
            nowait=True,
        )
    )
    if owners:
        session.execute(
            delete(WorkflowNodeExecutionOffload).where(
                WorkflowNodeExecutionOffload.tenant_id == tenant_id,
                WorkflowNodeExecutionOffload.id.in_(tuple(owner.id for owner in owners)),
            )
        )
        session.flush()
    return claim_orphan_upload_files(
        session,
        tenant_id=tenant_id,
        files=tuple(UploadFileCleanup(id=file.id, key=file.key) for file in locked_files),
    )


def detach_workflow_draft_variables_and_claim_uploads(
    session: Session,
    *,
    tenant_id: str,
    draft_variable_ids: Sequence[str],
) -> tuple[UploadFileCleanup, ...]:
    """Detach ordinary and offloaded draft variables behind the upload-file fence."""

    unique_variable_ids = tuple(sorted(_unique(draft_variable_ids)))
    if not unique_variable_ids:
        return ()

    def load_owner_state(
        *,
        lock: bool,
    ) -> tuple[tuple[WorkflowDraftVariable, ...], tuple[WorkflowDraftVariableFile, ...], tuple[str, ...]]:
        variable_statement = (
            select(WorkflowDraftVariable)
            .where(WorkflowDraftVariable.id.in_(unique_variable_ids))
            .order_by(WorkflowDraftVariable.id)
        )
        if lock:
            variable_statement = variable_statement.with_for_update(nowait=True)
        variables = tuple(session.scalars(variable_statement).all())
        variable_ids = tuple(variable.id for variable in variables)
        draft_file_ids = tuple(sorted(_unique([variable.file_id for variable in variables if variable.file_id])))
        owner_statement = (
            select(WorkflowDraftVariableFile)
            .where(
                WorkflowDraftVariableFile.tenant_id == tenant_id,
                WorkflowDraftVariableFile.id.in_(draft_file_ids),
            )
            .order_by(WorkflowDraftVariableFile.id)
        )
        if lock:
            owner_statement = owner_statement.with_for_update(nowait=True)
        owners = tuple(session.scalars(owner_statement).all()) if draft_file_ids else ()
        candidate_ids = list(
            session.scalars(
                select(WorkflowDraftVariableUploadFileReference.upload_file_id).where(
                    WorkflowDraftVariableUploadFileReference.tenant_id == tenant_id,
                    WorkflowDraftVariableUploadFileReference.draft_variable_id.in_(variable_ids),
                )
            ).all()
        )
        for variable in variables:
            candidate_ids.extend(_workflow_draft_variable_upload_file_ids(variable))
        candidate_ids.extend(owner.upload_file_id for owner in owners)
        return variables, owners, tuple(sorted(_unique(candidate_ids)))

    _, _, initial_candidate_ids = load_owner_state(lock=False)
    locked_files = list(
        _lock_upload_files_for_cleanup(
            session,
            tenant_id=tenant_id,
            file_ids=initial_candidate_ids,
        )
    )
    variables, owners, current_candidate_ids = load_owner_state(lock=True)
    locked_ids = {file.id for file in locked_files}
    locked_files.extend(
        _lock_upload_files_for_cleanup(
            session,
            tenant_id=tenant_id,
            file_ids=tuple(file_id for file_id in current_candidate_ids if file_id not in locked_ids),
            nowait=True,
        )
    )
    variable_ids = tuple(variable.id for variable in variables)
    if variable_ids:
        session.execute(
            delete(WorkflowDraftVariableUploadFileReference).where(
                WorkflowDraftVariableUploadFileReference.tenant_id == tenant_id,
                WorkflowDraftVariableUploadFileReference.draft_variable_id.in_(variable_ids),
            )
        )
        session.execute(delete(WorkflowDraftVariable).where(WorkflowDraftVariable.id.in_(variable_ids)))
    owner_ids = tuple(owner.id for owner in owners)
    if owner_ids:
        session.execute(
            delete(WorkflowDraftVariableFile).where(
                WorkflowDraftVariableFile.tenant_id == tenant_id,
                WorkflowDraftVariableFile.id.in_(owner_ids),
            )
        )
    session.flush()
    candidates = tuple(UploadFileCleanup(id=file.id, key=file.key) for file in locked_files)
    return claim_orphan_upload_files(
        session,
        tenant_id=tenant_id,
        files=candidates,
    )


def snapshot_conversation_upload_files(
    session: Session,
    *,
    conversation_id: str,
) -> tuple[tuple[str, UploadFileCleanup], ...]:
    """Snapshot UploadFile owners that conversation cleanup is about to detach."""

    message_files = session.execute(
        select(UploadFile.tenant_id, UploadFile.id, UploadFile.key)
        .join(MessageFile, MessageFile.upload_file_id == UploadFile.id)
        .join(Message, Message.id == MessageFile.message_id)
        .where(
            Message.conversation_id == conversation_id,
            MessageFile.upload_file_id.is_not(None),
        )
    ).all()
    human_input_files = session.execute(
        select(UploadFile.tenant_id, UploadFile.id, UploadFile.key)
        .join(HumanInputFormUploadFile, HumanInputFormUploadFile.upload_file_id == UploadFile.id)
        .join(HumanInputForm, HumanInputForm.id == HumanInputFormUploadFile.form_id)
        .where(HumanInputForm.conversation_id == conversation_id)
    ).all()
    by_owner = {
        (row.tenant_id, row.id): (row.tenant_id, UploadFileCleanup(id=row.id, key=row.key))
        for row in (*message_files, *human_input_files)
    }
    for tenant_id in sorted({tenant_id for tenant_id, _ in by_owner}):
        _lock_upload_files_for_cleanup(
            session,
            tenant_id=tenant_id,
            file_ids=tuple(file_id for owner_tenant_id, file_id in by_owner if owner_tenant_id == tenant_id),
        )
    return tuple(by_owner[key] for key in sorted(by_owner))


def snapshot_and_detach_app_upload_files(
    session: Session,
    *,
    tenant_id: str,
    app_id: str,
) -> tuple[UploadFileCleanup, ...]:
    """Snapshot App-owned ordinary draft and icon files, then detach draft owners.

    The caller deletes and flushes the App row before passing these snapshots to
    ``claim_orphan_upload_files`` in the same transaction. Large-value draft
    offloads retain their separate owner rows until their storage cleanup has
    succeeded.
    """

    def load_owner_state(*, lock: bool) -> tuple[App | None, tuple[WorkflowDraftVariable, ...], tuple[str, ...]]:
        app_statement = select(App).where(App.id == app_id, App.tenant_id == tenant_id)
        site_statement = select(Site.icon_type, Site.icon).where(Site.app_id == app_id)
        variable_statement = (
            select(WorkflowDraftVariable)
            .where(
                WorkflowDraftVariable.app_id == app_id,
                WorkflowDraftVariable.file_id.is_(None),
            )
            .order_by(WorkflowDraftVariable.id)
        )
        if lock:
            app_statement = app_statement.with_for_update(nowait=True)
            site_statement = site_statement.with_for_update(nowait=True)
            variable_statement = variable_statement.with_for_update(nowait=True)
        app_owner = session.scalar(app_statement.execution_options(populate_existing=True))
        if app_owner is None:
            return None, (), ()
        site_icons = session.execute(site_statement).all()
        ordinary_variables = tuple(session.scalars(variable_statement).all())
        candidate_ids: list[str] = []
        app_icon_id = extract_app_icon_upload_file_id(app_owner.icon_type, app_owner.icon)
        if app_icon_id is not None:
            candidate_ids.append(app_icon_id)
        candidate_ids.extend(
            file_id
            for icon_type, icon in site_icons
            if (file_id := extract_app_icon_upload_file_id(icon_type, icon)) is not None
        )
        ordinary_variable_ids = tuple(variable.id for variable in ordinary_variables)
        if ordinary_variable_ids:
            candidate_ids.extend(
                session.scalars(
                    select(WorkflowDraftVariableUploadFileReference.upload_file_id).where(
                        WorkflowDraftVariableUploadFileReference.tenant_id == tenant_id,
                        WorkflowDraftVariableUploadFileReference.app_id == app_id,
                        WorkflowDraftVariableUploadFileReference.draft_variable_id.in_(ordinary_variable_ids),
                    )
                ).all()
            )
            for variable in ordinary_variables:
                candidate_ids.extend(_workflow_draft_variable_upload_file_ids(variable))
        return app_owner, ordinary_variables, tuple(sorted(_unique(candidate_ids)))

    app, _, initial_candidate_ids = load_owner_state(lock=False)
    if app is None:
        raise LookupError("app upload-file owner no longer exists")
    locked_files = list(
        _lock_upload_files_for_cleanup(
            session,
            tenant_id=tenant_id,
            file_ids=initial_candidate_ids,
        )
    )
    app, ordinary_variables, current_candidate_ids = load_owner_state(lock=True)
    if app is None:
        raise LookupError("app upload-file owner no longer exists")
    locked_ids = {file.id for file in locked_files}
    locked_files.extend(
        _lock_upload_files_for_cleanup(
            session,
            tenant_id=tenant_id,
            file_ids=tuple(file_id for file_id in current_candidate_ids if file_id not in locked_ids),
            nowait=True,
        )
    )
    snapshots_by_id = {file.id: UploadFileCleanup(id=file.id, key=file.key) for file in locked_files}
    unique_candidate_ids = tuple(sorted(snapshots_by_id))
    ordinary_variable_ids = tuple(variable.id for variable in ordinary_variables)

    if ordinary_variable_ids:
        session.execute(
            delete(WorkflowDraftVariableUploadFileReference).where(
                WorkflowDraftVariableUploadFileReference.tenant_id == tenant_id,
                WorkflowDraftVariableUploadFileReference.app_id == app_id,
                WorkflowDraftVariableUploadFileReference.draft_variable_id.in_(ordinary_variable_ids),
            )
        )
        session.execute(delete(WorkflowDraftVariable).where(WorkflowDraftVariable.id.in_(ordinary_variable_ids)))
    session.flush()
    return tuple(snapshots_by_id[file_id] for file_id in unique_candidate_ids if file_id in snapshots_by_id)


def find_claimed_upload_files(
    session: Session,
    *,
    limit: int,
    tenant_id: str | None = None,
) -> tuple[tuple[str, UploadFileCleanup], ...]:
    """Return a bounded oldest-first batch for crash recovery."""

    if limit < 1:
        return ()
    statement = (
        select(UploadFile.tenant_id, UploadFile.id, UploadFile.key)
        .where(UploadFile.knowledge_cleanup_started_at.is_not(None))
        .order_by(UploadFile.knowledge_cleanup_started_at, UploadFile.id)
        .limit(limit)
    )
    if tenant_id is not None:
        statement = statement.where(UploadFile.tenant_id == tenant_id)
    rows = session.execute(statement).all()
    return tuple((row.tenant_id, UploadFileCleanup(id=row.id, key=row.key)) for row in rows)


def delete_orphan_upload_files(
    session: Session,
    *,
    tenant_id: str,
    files: Sequence[UploadFileCleanup],
    excluding_message_app_id: str | None = None,
    excluding_workflow_offload_ids: Sequence[str] = (),
    excluding_workflow_draft_file_ids: Sequence[str] = (),
) -> None:
    """Finalize storage cleanup while holding the same reference fence."""

    file_ids = tuple(sorted(_unique([file.id for file in files])))
    if not file_ids:
        return
    locked_files = tuple(
        file
        for candidate_batch in batched(file_ids, _REFERENCE_SCAN_BATCH_SIZE, strict=False)
        for file in session.scalars(
            select(UploadFile)
            .where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(candidate_batch))
            .order_by(UploadFile.id)
            .with_for_update()
        ).all()
    )
    for candidate_batch in batched(file_ids, _REFERENCE_SCAN_BATCH_SIZE, strict=False):
        remove_stale_knowledge_file_edges(session, tenant_id=tenant_id, file_ids=candidate_batch)
    orphan_ids = {
        file.id
        for file in find_orphan_upload_files(
            session,
            tenant_id=tenant_id,
            files=tuple(UploadFileCleanup(id=file.id, key=file.key) for file in locked_files),
            excluding_message_app_id=excluding_message_app_id,
            excluding_workflow_offload_ids=excluding_workflow_offload_ids,
            excluding_workflow_draft_file_ids=excluding_workflow_draft_file_ids,
        )
    }
    for file in locked_files:
        if file.id not in orphan_ids:
            file.knowledge_cleanup_started_at = None
            continue
        if file.knowledge_cleanup_started_at is not None:
            session.delete(file)


def _query_files(session: Session, *, workspace_id: str, file_ids: Sequence[str]) -> dict[str, UploadFile]:
    if not file_ids:
        return {}
    uploads = session.scalars(
        select(UploadFile).where(UploadFile.id.in_(file_ids), UploadFile.tenant_id == workspace_id)
    )
    return {upload.id: upload for upload in uploads}


def query_upload_extraction_inputs(
    session: Session, *, workspace_id: str, file_ids: Sequence[str]
) -> dict[str, UploadFileExtractionInput]:
    """Read detached extraction inputs without changing the caller's session lifecycle."""
    return {
        upload.id: UploadFileExtractionInput.model_validate(upload)
        for upload in _query_files(session, workspace_id=workspace_id, file_ids=file_ids).values()
    }


class SQLAlchemyKnowledgeUploadRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_by_id(self, *, workspace_id: str, file_id: str) -> UploadFileExtractionInput | None:
        return self.get_by_ids(workspace_id=workspace_id, file_ids=(file_id,)).get(file_id)

    def get_by_ids(self, *, workspace_id: str, file_ids: Sequence[str]) -> dict[str, UploadFileExtractionInput]:
        with self._session_factory() as session:
            return query_upload_extraction_inputs(session, workspace_id=workspace_id, file_ids=file_ids)

    def get_files(self, *, workspace_id: str, file_ids: Sequence[str]) -> dict[str, UploadFile]:
        with self._session_factory() as session:
            return _query_files(session, workspace_id=workspace_id, file_ids=file_ids)

    def get_file_name(self, *, workspace_id: str, upload_file_id: str) -> str | None:
        upload = self.get_files(workspace_id=workspace_id, file_ids=(upload_file_id,)).get(upload_file_id)
        return upload.name if upload is not None else None
