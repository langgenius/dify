"""Builders for the model instances unit tests construct over and over.

Every builder returns a transient (unpersisted) instance carrying the field set
that most call sites need, so a test module only spells out the values it
actually asserts on. Keyword arguments map one-to-one onto model columns.
"""

import json
from collections.abc import Mapping, Sequence
from datetime import datetime
from decimal import Decimal

from extensions.storage.storage_type import StorageType
from graphon.variables import VariableBase
from models.account import Account, AccountStatus, Tenant, TenantAccountRole, TenantStatus
from models.dataset import Dataset, Document
from models.enums import (
    AppStatus,
    CreatorUserRole,
    DataSourceType,
    DocumentCreatedFrom,
    EndUserType,
    PermissionEnum,
)
from models.model import (
    App,
    AppMode,
    Conversation,
    ConversationFromSource,
    EndUser,
    IconType,
    Message,
    UploadFile,
)
from models.workflow import Workflow, WorkflowKind, WorkflowType
from services.entities.account_entities import AccountSnapshot


def make_app(
    *,
    app_id: str = "app-1",
    tenant_id: str = "tenant-1",
    name: str = "Test App",
    description: str = "",
    mode: AppMode = AppMode.CHAT,
    icon_type: IconType | None = IconType.EMOJI,
    icon: str | None = "robot",
    icon_background: str | None = "#FFFFFF",
    status: AppStatus = AppStatus.NORMAL,
    app_model_config_id: str | None = None,
    workflow_id: str | None = None,
    enable_site: bool = True,
    enable_api: bool = True,
    api_rpm: int = 0,
    api_rph: int = 0,
    is_demo: bool = False,
    is_public: bool = False,
    is_universal: bool = False,
    max_active_requests: int | None = None,
    tracing: str | None = None,
    created_by: str | None = None,
    maintainer: str | None = None,
    use_icon_as_answer_icon: bool = False,
) -> App:
    """Build a transient ``App``.

    ``app_id`` is spelled out instead of ``id`` so call sites never shadow the
    builtin. ``icon_type=None`` clears ``icon`` and ``icon_background`` too, for
    the tests that assert on an app without icon metadata.
    """
    if icon_type is None:
        icon = None
        icon_background = None
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name=name,
        description=description,
        mode=mode,
        icon_type=icon_type,
        icon=icon,
        icon_background=icon_background,
        status=status,
        app_model_config_id=app_model_config_id,
        workflow_id=workflow_id,
        enable_site=enable_site,
        enable_api=enable_api,
        api_rpm=api_rpm,
        api_rph=api_rph,
        is_demo=is_demo,
        is_public=is_public,
        is_universal=is_universal,
        max_active_requests=max_active_requests,
        tracing=tracing,
        created_by=created_by,
        maintainer=maintainer,
        use_icon_as_answer_icon=use_icon_as_answer_icon,
    )


def make_account(
    *,
    account_id: str | None = "account-1",
    name: str = "Test User",
    email: str = "test@example.com",
    status: AccountStatus = AccountStatus.ACTIVE,
    interface_language: str | None = None,
    timezone: str | None = None,
    role: TenantAccountRole | None = None,
    tenant: Tenant | None = None,
) -> Account:
    """Build a transient ``Account``.

    ``id``, ``role`` and ``_current_tenant`` are ``init=False`` on the dataclass
    model, so they are assigned after construction. Passing ``account_id=None``
    keeps the generated identifier.
    """
    account = Account(
        name=name,
        email=email,
        status=status,
        interface_language=interface_language,
        timezone=timezone,
    )
    if account_id is not None:
        account.id = account_id
    account.role = role
    account._current_tenant = tenant
    return account


def make_tenant(
    *,
    tenant_id: str | None = "tenant-1",
    name: str = "Test Tenant",
    status: TenantStatus = TenantStatus.NORMAL,
    encrypt_public_key: str | None = None,
) -> Tenant:
    """Build a transient ``Tenant``; ``tenant_id=None`` keeps the generated one."""
    tenant = Tenant(name=name, status=status, encrypt_public_key=encrypt_public_key)
    if tenant_id is not None:
        tenant.id = tenant_id
    return tenant


def make_end_user(
    *,
    end_user_id: str = "end-user-1",
    tenant_id: str = "tenant-1",
    app_id: str | None = None,
    end_user_type: EndUserType = EndUserType.BROWSER,
    session_id: str = "session-1",
    external_user_id: str | None = None,
    name: str | None = None,
    is_anonymous: bool = True,
) -> EndUser:
    """Build a transient ``EndUser``."""
    return EndUser(
        id=end_user_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=end_user_type,
        session_id=session_id,
        external_user_id=external_user_id,
        name=name,
        is_anonymous=is_anonymous,
    )


def make_account_snapshot(
    *,
    account_id: str = "account-1",
    name: str = "Account",
    email: str = "account@example.com",
    avatar: str | None = None,
    is_password_set: bool = False,
    interface_language: str | None = "en-US",
    interface_theme: str | None = "light",
    timezone: str | None = "UTC",
    last_login_at: datetime | None = None,
    last_login_ip: str | None = None,
    status: str = "active",
    initialized_at: datetime | None = None,
    created_at: datetime = datetime(2026, 1, 1),
) -> AccountSnapshot:
    """Build the framework-neutral ``AccountSnapshot`` the account services return."""
    return AccountSnapshot(
        id=account_id,
        name=name,
        email=email,
        avatar=avatar,
        is_password_set=is_password_set,
        interface_language=interface_language,
        interface_theme=interface_theme,
        timezone=timezone,
        last_login_at=last_login_at,
        last_login_ip=last_login_ip,
        status=status,
        initialized_at=initialized_at,
        created_at=created_at,
    )


def make_workflow(
    *,
    workflow_id: str | None = None,
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    workflow_type: WorkflowType = WorkflowType.WORKFLOW,
    kind: WorkflowKind = WorkflowKind.STANDARD,
    version: str = Workflow.VERSION_DRAFT,
    graph: str | Mapping[str, object] | None = None,
    features: str | Mapping[str, object] = "{}",
    created_by: str = "account-1",
    environment_variables: Sequence[VariableBase] = (),
    conversation_variables: Sequence[VariableBase] = (),
    rag_pipeline_variables: list[dict] | None = None,
    marked_name: str = "",
    marked_comment: str = "",
    version_number: int | None = None,
) -> Workflow:
    """Build a transient ``Workflow`` through ``Workflow.new``.

    ``graph`` and ``features`` accept either the serialized column value or the
    mapping to serialize, since most call sites start from a graph literal.
    ``workflow_id=None`` keeps the identifier ``Workflow.new`` generates.
    """
    workflow = Workflow.new(
        tenant_id=tenant_id,
        app_id=app_id,
        type=workflow_type.value,
        kind=kind.value,
        version=version,
        graph=graph if isinstance(graph, str) else json.dumps({"nodes": [], "edges": []} if graph is None else graph),
        features=features if isinstance(features, str) else json.dumps(features),
        created_by=created_by,
        environment_variables=environment_variables,
        conversation_variables=conversation_variables,
        rag_pipeline_variables=rag_pipeline_variables or [],
        marked_name=marked_name,
        marked_comment=marked_comment,
        version_number=version_number,
    )
    if workflow_id is not None:
        workflow.id = workflow_id
    return workflow


def make_upload_file(
    *,
    file_id: str | None = None,
    tenant_id: str = "tenant-1",
    storage_type: StorageType = StorageType.LOCAL,
    key: str = "uploads/file-1",
    name: str = "test.txt",
    size: int = 10,
    extension: str = "txt",
    mime_type: str = "text/plain",
    created_by_role: CreatorUserRole = CreatorUserRole.ACCOUNT,
    created_by: str = "account-1",
    created_at: datetime | None = None,
    used: bool = False,
    source_url: str = "",
) -> UploadFile:
    """Build a transient ``UploadFile``; ``file_id=None`` keeps the generated one."""
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=storage_type,
        key=key,
        name=name,
        size=size,
        extension=extension,
        mime_type=mime_type,
        created_by_role=created_by_role,
        created_by=created_by,
        created_at=created_at if created_at is not None else datetime(2024, 1, 1),
        used=used,
        source_url=source_url,
    )
    if file_id is not None:
        upload_file.id = file_id
    return upload_file


def make_dataset(
    *,
    dataset_id: str | None = "dataset-1",
    tenant_id: str = "tenant-1",
    name: str = "Dataset",
    description: str | None = None,
    provider: str | None = None,
    permission: PermissionEnum | None = None,
    data_source_type: DataSourceType | None = None,
    indexing_technique: str | None = None,
    index_struct: str | None = None,
    created_by: str = "account-1",
    maintainer: str | None = None,
    created_at: datetime | None = None,
    embedding_model: str | None = None,
    embedding_model_provider: str | None = None,
    keyword_number: int | None = None,
    built_in_field_enabled: bool | None = None,
    icon_info: dict[str, str] | None = None,
    pipeline_id: str | None = None,
    chunk_structure: str | None = None,
    enable_api: bool | None = None,
) -> Dataset:
    """Build a transient ``Dataset``.

    Optional columns default to ``None`` so an unset keyword leaves the column
    unset, matching a bare ``Dataset(...)``. ``dataset_id=None`` keeps the
    generated identifier.
    """
    values: dict[str, object] = {"tenant_id": tenant_id, "name": name, "created_by": created_by}
    optional: dict[str, object | None] = {
        "id": dataset_id,
        "description": description,
        "provider": provider,
        "permission": permission,
        "data_source_type": data_source_type,
        "indexing_technique": indexing_technique,
        "index_struct": index_struct,
        "maintainer": maintainer,
        "created_at": created_at,
        "embedding_model": embedding_model,
        "embedding_model_provider": embedding_model_provider,
        "keyword_number": keyword_number,
        "built_in_field_enabled": built_in_field_enabled,
        "icon_info": icon_info,
        "pipeline_id": pipeline_id,
        "chunk_structure": chunk_structure,
        "enable_api": enable_api,
    }
    values.update({key: value for key, value in optional.items() if value is not None})
    return Dataset(**values)


def make_conversation(
    *,
    conversation_id: str | None = "conversation-1",
    app_id: str = "app-1",
    mode: AppMode = AppMode.CHAT,
    name: str = "Conversation",
    inputs: Mapping[str, object] | None = None,
    status: str | None = None,
    from_source: ConversationFromSource | None = None,
    from_account_id: str | None = None,
    from_end_user_id: str | None = None,
    invoke_from: str | None = None,
    introduction: str | None = None,
    system_instruction: str | None = None,
    system_instruction_tokens: int | None = None,
    override_model_configs: str | None = None,
    summary: str | None = None,
    dialogue_count: int | None = None,
    is_deleted: bool | None = None,
    agent_workspace_binding_id: str | None = None,
) -> Conversation:
    """Build a transient ``Conversation``; unset keywords leave their column unset."""
    values: dict[str, object] = {"app_id": app_id, "mode": mode, "name": name}
    optional: dict[str, object | None] = {
        "id": conversation_id,
        "inputs": inputs,
        "status": status,
        "from_source": from_source,
        "from_account_id": from_account_id,
        "from_end_user_id": from_end_user_id,
        "invoke_from": invoke_from,
        "introduction": introduction,
        "system_instruction": system_instruction,
        "system_instruction_tokens": system_instruction_tokens,
        "override_model_configs": override_model_configs,
        "summary": summary,
        "dialogue_count": dialogue_count,
        "is_deleted": is_deleted,
        "agent_workspace_binding_id": agent_workspace_binding_id,
    }
    values.update({key: value for key, value in optional.items() if value is not None})
    return Conversation(**values)


def make_message(
    *,
    message_id: str | None = "message-1",
    app_id: str | None = "app-1",
    conversation_id: str | None = "conversation-1",
    inputs: Mapping[str, object] | None = None,
    query: str | None = None,
    message: object | None = None,
    answer: str | None = None,
    status: str | None = None,
    message_unit_price: Decimal | None = None,
    answer_unit_price: Decimal | None = None,
    total_price: Decimal | None = None,
    currency: str | None = None,
    from_source: ConversationFromSource | None = None,
    from_account_id: str | None = None,
    from_end_user_id: str | None = None,
    invoke_from: str | None = None,
    message_tokens: int | None = None,
    answer_tokens: int | None = None,
    provider_response_latency: float | None = None,
    workflow_run_id: str | None = None,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> Message:
    """Build a transient ``Message``; unset keywords leave their column unset."""
    values: dict[str, object] = {}
    optional: dict[str, object | None] = {
        "id": message_id,
        "app_id": app_id,
        "conversation_id": conversation_id,
        "inputs": inputs,
        "query": query,
        "message": message,
        "answer": answer,
        "status": status,
        "message_unit_price": message_unit_price,
        "answer_unit_price": answer_unit_price,
        "total_price": total_price,
        "currency": currency,
        "from_source": from_source,
        "from_account_id": from_account_id,
        "from_end_user_id": from_end_user_id,
        "invoke_from": invoke_from,
        "message_tokens": message_tokens,
        "answer_tokens": answer_tokens,
        "provider_response_latency": provider_response_latency,
        "workflow_run_id": workflow_run_id,
        "created_at": created_at,
        "updated_at": updated_at,
    }
    values.update({key: value for key, value in optional.items() if value is not None})
    return Message(**values)


def make_document(
    *,
    document_id: str | None = "document-1",
    tenant_id: str = "tenant-1",
    dataset_id: str = "dataset-1",
    position: int = 1,
    data_source_type: DataSourceType = DataSourceType.UPLOAD_FILE,
    data_source_info: str | None = None,
    batch: str = "batch-1",
    name: str = "Document",
    created_from: str = DocumentCreatedFrom.WEB,
    created_by: str = "account-1",
    doc_form: str | None = None,
    doc_metadata: dict[str, object] | None = None,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> Document:
    """Build a transient ``Document``; unset keywords leave their column unset."""
    values: dict[str, object] = {
        "tenant_id": tenant_id,
        "dataset_id": dataset_id,
        "position": position,
        "data_source_type": data_source_type,
        "batch": batch,
        "name": name,
        "created_from": created_from,
        "created_by": created_by,
    }
    optional: dict[str, object | None] = {
        "id": document_id,
        "data_source_info": data_source_info,
        "doc_form": doc_form,
        "doc_metadata": doc_metadata,
        "created_at": created_at,
        "updated_at": updated_at,
    }
    values.update({key: value for key, value in optional.items() if value is not None})
    return Document(**values)


__all__ = [
    "make_account",
    "make_account_snapshot",
    "make_app",
    "make_conversation",
    "make_dataset",
    "make_document",
    "make_end_user",
    "make_message",
    "make_tenant",
    "make_upload_file",
    "make_workflow",
]
