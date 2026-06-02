"""Workflow draft endpoints for API v2.

WIP: only owns the workflow canvas load/save HTTP contract now
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from api_fastapi.dependencies import EditorAccountDep, SyncSessionDep, editable_app_model_dependency
from api_fastapi.exceptions import DraftWorkflowNotExistError, DraftWorkflowNotSyncError
from core.helper import encrypter
from fields.member_fields import SimpleAccount
from graphon.variables import SecretVariable, SegmentType, VariableBase
from libs.helper import to_timestamp
from models import Account, App
from models.model import AppMode
from models.workflow import Workflow
from services.errors.app import WorkflowHashNotEqualError
from services.workflow_service import WorkflowService

router = APIRouter(prefix="/apps/{app_id}/workflows", tags=["workflows"])


class WorkflowEnvironmentVariableResponse(BaseModel):
    """Environment variable data exposed to the workflow canvas."""

    id: str
    name: str
    value: Any = Field(json_schema_extra={"type": "object"})
    value_type: str
    description: str | None = None

    model_config = ConfigDict(extra="forbid")


class WorkflowConversationVariableResponse(BaseModel):
    """Conversation variable data exposed to the workflow canvas."""

    id: str
    name: str
    value: Any = Field(json_schema_extra={"type": "object"})
    value_type: str
    description: str | None = None

    model_config = ConfigDict(extra="forbid")


class PipelineVariableResponse(BaseModel):
    """RAG pipeline variable shape preserved for shared workflow UI contracts."""

    label: str
    variable: str
    type: str
    belong_to_node_id: str
    max_length: int | None = None
    required: bool
    unit: str | None = None
    default_value: Any = Field(default=None, json_schema_extra={"type": "object"})
    options: list[str] | None = None
    placeholder: str | None = None
    tooltips: str | None = None
    allowed_file_types: list[str] | None = None
    allowed_file_extensions: list[str] | None = None
    allowed_file_upload_methods: list[str] | None = None

    model_config = ConfigDict(extra="forbid")


class WorkflowVariablePayload(BaseModel):
    """Variable mapping accepted by the workflow canvas save contract."""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    value: Any = Field(json_schema_extra={"type": "object"})
    value_type: SegmentType
    description: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("value")
    @classmethod
    def validate_value_is_not_none(cls, value: Any) -> Any:
        """Match the workflow variable factory contract before service mutation."""

        if value is None:
            raise ValueError("value is required")
        return value


class WorkflowDraftResponse(BaseModel):
    """Draft workflow contract consumed by the workflow canvas."""

    id: str
    graph: dict[str, Any]
    features: dict[str, Any]
    hash: str
    version: str
    marked_name: str
    marked_comment: str
    created_by: SimpleAccount | None = None
    created_at: int
    updated_by: SimpleAccount | None = None
    updated_at: int
    tool_published: bool
    environment_variables: list[WorkflowEnvironmentVariableResponse]
    conversation_variables: list[WorkflowConversationVariableResponse]
    rag_pipeline_variables: list[PipelineVariableResponse]

    model_config = ConfigDict(extra="forbid")


class SyncDraftWorkflowPayload(BaseModel):
    """Payload for saving the workflow canvas draft.

    ``hash`` is an optimistic concurrency token generated from the stored graph.
    Existing clients send masked secret values back during ordinary canvas saves;
    the service normalizes those masks before rebuilding variable objects.
    """

    graph: dict[str, Any]
    features: dict[str, Any]
    hash: str | None = None
    environment_variables: list[WorkflowVariablePayload] = Field(default_factory=list)
    conversation_variables: list[WorkflowVariablePayload] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class SyncDraftWorkflowResponse(BaseModel):
    id: str
    hash: str
    updated_at: int

    model_config = ConfigDict(extra="forbid")


WorkflowDraftAppDep = Annotated[
    App,
    editable_app_model_dependency(modes=(AppMode.ADVANCED_CHAT, AppMode.WORKFLOW)),
]


@router.get("/draft", response_model=WorkflowDraftResponse)
def get_draft_workflow(
    app_model: WorkflowDraftAppDep,
    session: SyncSessionDep,
) -> WorkflowDraftResponse:
    """Return the tenant-scoped draft workflow for the workflow canvas."""

    workflow_service = WorkflowService.from_session(session)
    workflow = workflow_service.get_draft_workflow(app_model=app_model, session=session)
    if workflow is None:
        raise DraftWorkflowNotExistError()
    return _dump_workflow_response(session, workflow)


@router.post("/draft", response_model=SyncDraftWorkflowResponse)
def sync_draft_workflow(
    app_model: WorkflowDraftAppDep,
    payload: SyncDraftWorkflowPayload,
    session: SyncSessionDep,
    current_account: EditorAccountDep,
) -> SyncDraftWorkflowResponse:
    """Persist the workflow canvas draft and return the new hash."""

    workflow_service = WorkflowService.from_session(session)
    try:
        workflow = workflow_service.sync_draft_workflow_with_session(
            app_model=app_model,
            graph=payload.graph,
            features=payload.features,
            unique_hash=payload.hash,
            account=current_account.account,
            environment_variable_mappings=[
                variable.model_dump(mode="json") for variable in payload.environment_variables
            ],
            conversation_variable_mappings=[
                variable.model_dump(mode="json") for variable in payload.conversation_variables
            ],
        )
    except WorkflowHashNotEqualError:
        raise DraftWorkflowNotSyncError()

    updated_at = to_timestamp(workflow.updated_at or workflow.created_at)
    if updated_at is None:
        raise ValueError("workflow updated_at is required")
    return SyncDraftWorkflowResponse(id=workflow.id, hash=workflow.unique_hash, updated_at=updated_at)


def _dump_workflow_response(session: Session, workflow: Workflow) -> WorkflowDraftResponse:
    # TODO: make these joins so we save DB RTTs
    # TODO: Also, we should forbid accessing DB objects from controller
    # but we are relying on the old code, so we postpone this a bit
    # The old code hides DB operation through Pydantic serialization
    # triggered property access, which even worse.
    created_at = to_timestamp(workflow.created_at)
    updated_at = to_timestamp(workflow.updated_at)
    if created_at is None or updated_at is None:
        raise ValueError("workflow timestamps are required")

    return WorkflowDraftResponse(
        id=workflow.id,
        graph=dict(workflow.graph_dict),
        features=workflow.features_dict,
        hash=workflow.unique_hash,
        version=workflow.version,
        marked_name=workflow.marked_name,
        marked_comment=workflow.marked_comment,
        created_by=_dump_simple_account(session, workflow.created_by),
        created_at=created_at,
        updated_by=_dump_simple_account(session, workflow.updated_by),
        updated_at=updated_at,
        tool_published=_workflow_tool_published(session, workflow),
        environment_variables=[
            WorkflowEnvironmentVariableResponse.model_validate(_dump_environment_variable(variable))
            for variable in workflow.environment_variables
        ],
        conversation_variables=[
            WorkflowConversationVariableResponse.model_validate(_dump_conversation_variable(variable))
            for variable in workflow.conversation_variables
        ],
        rag_pipeline_variables=[
            PipelineVariableResponse.model_validate(variable) for variable in workflow.rag_pipeline_variables
        ],
    )


def _dump_simple_account(session: Session, account_id: str | None) -> SimpleAccount | None:
    if account_id is None:
        return None
    account = session.get(Account, account_id)
    return SimpleAccount.model_validate(account, from_attributes=True) if account else None


def _workflow_tool_published(session: Session, workflow: Workflow) -> bool:
    from models.tools import WorkflowToolProvider

    stmt = select(
        exists().where(
            WorkflowToolProvider.tenant_id == workflow.tenant_id,
            WorkflowToolProvider.app_id == workflow.app_id,
        )
    )
    return session.execute(stmt).scalar_one()


def _dump_environment_variable(value: VariableBase) -> dict[str, Any]:
    if isinstance(value, SecretVariable):
        return {
            "id": value.id,
            "name": value.name,
            "value": encrypter.full_mask_token(),
            "value_type": value.value_type.value,
            "description": value.description,
        }

    return {
        "id": value.id,
        "name": value.name,
        "value": value.value,
        "value_type": str(value.value_type.exposed_type()),
        "description": value.description,
    }


def _dump_conversation_variable(value: VariableBase) -> dict[str, Any]:
    value_type = value.value_type
    exposed_type = value_type.exposed_type() if isinstance(value_type, SegmentType) else value_type
    return {
        "id": value.id,
        "name": value.name,
        "value": value.value,
        "value_type": str(exposed_type),
        "description": value.description,
    }
