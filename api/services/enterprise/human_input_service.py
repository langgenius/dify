"""AppDeploy HITL application boundary reusing the ordinary v2 lifecycle."""

import json
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, JsonValue, TypeAdapter
from sqlalchemy import select

from configs import dify_config
from core.app.entities.task_entities import HumanInputRequiredResponse
from core.db.session_factory import session_factory
from core.human_input_v2.shared.values import AccountId, TenantId
from core.workflow.nodes.human_input.entities import HumanInputNodeDataFull
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from core.workflow.nodes.human_input_v2.runtime import PreparedForm
from factories.human_input_v2_form_presentation import build_form_presentation, render_filled_content
from graphon.runtime import VariablePool
from libs.datetime_utils import ensure_naive_utc
from libs.helper import to_timestamp
from models.model import App, EndUser
from models.utils.file_input_compat import restore_input_files
from repositories.app_scoped_end_user_repository import AppScopedEndUserRepo
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from services.app_scoped_end_user_service import AppScopedEndUserService
from services.human_input_v2.composition import (
    build_human_input_delivery_service,
    build_human_input_node_data_migration_service,
)
from services.human_input_v2.form_service import (
    AccountInitiator,
    EndUserInitiator,
    FormExecutionContext,
    HumanInputFormService,
    recover_initiator_prepared_form,
)
from services.human_input_v2.node_data_migration import MigrationNode, NodeDataMigrationFailure
from services.human_input_v2.runtime import DifyHumanInputRuntime


class OwnerRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    environment_id: str
    deployment_id: str
    revision_id: str


class InitiatorPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["end_user", "account"]
    id: str
    source: Literal["service_api"] | None = None


class PreparePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    owner_ref: OwnerRef
    node_execution_id: str
    node_id: str
    form_version: Literal["1", "2"]
    node_data: dict[str, JsonValue]
    variables: dict[str, JsonValue]
    initiator: InitiatorPayload | None = None
    run_created_at: datetime


class AppDeployHumanInputService:
    """Require a real App owner; never create a shadow community WorkflowRun."""

    @staticmethod
    def tenant_id(app_id: str) -> TenantId:
        """Return the trusted App tenant or reject an unknown App without writes."""
        with session_factory.create_session() as session:
            tenant = session.scalar(select(App.tenant_id).where(App.id == app_id))
        if tenant is None:
            raise LookupError("App not found")
        return TenantId(tenant)

    def prepare(self, app_id: str, run_id: str, payload: PreparePayload) -> dict[str, JsonValue]:
        """Initialize once per execution and return the worker's versioned projection.

        Accept validated execution facts from the authenticated Enterprise caller.
        Freeze v1 as v2 data before delivery; retries read the original snapshot.
        Recipient resolution and provider failures retain ordinary Dify semantics.
        """
        tenant_id = self.tenant_id(app_id)
        if payload.initiator is not None and payload.initiator.source == "service_api":
            if payload.initiator.type != "end_user":
                raise ValueError("Service API initiator must be an end user")
            payload = payload.model_copy(
                update={
                    "initiator": InitiatorPayload(
                        type="end_user",
                        id=resolve_service_api_end_user_id(
                            tenant_id=tenant_id, app_id=app_id, user=payload.initiator.id
                        ),
                    )
                }
            )
        owner_ref = {**payload.owner_ref.model_dump(), "node_id": payload.node_id}
        if payload.initiator is not None:
            owner_ref.update(initiator_type=payload.initiator.type, initiator_id=payload.initiator.id)
        with session_factory.create_session() as session:
            existing = SQLAlchemyFormRepository(session, tenant_id, app_id).get_form(run_id, payload.node_execution_id)
        if existing is not None:
            if (
                existing.run_gateway != "enterprise"
                or existing.owner_ref != owner_ref
                or existing.form_version != payload.form_version
            ):
                raise ValueError("Human Input execution ownership does not match")
            return project_prepared(
                recover_initiator_prepared_form(form=existing, session_factory=session_factory.create_session)
            )
        if payload.form_version == "1":
            legacy = HumanInputNodeDataFull.model_validate(payload.node_data)
            converted = build_human_input_node_data_migration_service().migrate(
                tenant_id=tenant_id, nodes=[MigrationNode(payload.node_id, legacy)]
            )
            if isinstance(converted, NodeDataMigrationFailure):
                raise ValueError(
                    "Legacy Human Input cannot be converted: " + ", ".join(b.code for b in converted.blockers)
                )
            node_data = converted.data[0].node_data
        else:
            node_data = HumanInputNodeData.model_validate_json(json.dumps(payload.node_data))
        initiator = None
        if payload.initiator is not None:
            if payload.initiator.type == "account":
                initiator = AccountInitiator(AccountId(payload.initiator.id))
            else:
                with session_factory.create_session() as session:
                    end_user = session.scalar(
                        select(EndUser.id).where(
                            EndUser.id == payload.initiator.id,
                            EndUser.app_id == app_id,
                            EndUser.tenant_id == tenant_id,
                        )
                    )
                if end_user is None:
                    raise ValueError("Initiator does not belong to the App")
                initiator = EndUserInitiator(end_user)
        context = FormExecutionContext(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=run_id,
            global_timeout_deadline=ensure_naive_utc(payload.run_created_at)
            + timedelta(seconds=dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS),
            initiator=initiator,
            debugging_account_id=None,
            run_gateway="enterprise",
            form_version=payload.form_version,
            owner_ref=owner_ref,
        )
        pool = VariablePool()
        variables = restore_input_files(inputs=payload.variables, tenant_resolver=lambda: str(tenant_id))
        for selector, value in variables.items():
            pool.add(selector.split("."), value)
        prepared = DifyHumanInputRuntime(
            form_service=HumanInputFormService(session_factory=session_factory.get_session_maker(), context=context),
            delivery_service=build_human_input_delivery_service(
                tenant_id=tenant_id, session_factory=session_factory.create_session
            ),
        ).prepare_form(node_execution_id=payload.node_execution_id, node_data=node_data, variable_pool=pool)
        if (
            prepared.form.run_gateway != "enterprise"
            or prepared.form.owner_ref != context.owner_ref
            or prepared.form.form_version != payload.form_version
        ):
            raise ValueError("Human Input execution ownership does not match")
        return project_prepared(prepared)


def resolve_service_api_end_user_id(*, tenant_id: TenantId, app_id: str, user: str) -> str:
    """Resolve a native Service API user, serializing AppDeploy's first provisioning.

    Require a persisted App in the trusted tenant. Concurrent prepare/submit
    requests must receive the same UUID even when the native repository has no
    unique session constraint; failures release the lock without accepting a form.
    """
    with session_factory.create_session() as session, session.begin():
        app = session.scalar(select(App.id).where(App.id == app_id, App.tenant_id == tenant_id).with_for_update())
        if app is None:
            raise LookupError("App not found")
        return (
            AppScopedEndUserService(end_users=AppScopedEndUserRepo(session_factory=session_factory.get_session_maker()))
            .get_or_create_end_user(str(tenant_id), app_id, user)
            .id
        )


def project_prepared(prepared: PreparedForm) -> dict[str, JsonValue]:
    """Project a persisted v2 outcome into the D1 contract without changing state."""
    form = prepared.form
    resolved = form.resolved_form
    assert form.owner_ref is not None
    node_id = form.owner_ref["node_id"]
    token = prepared.form_token.get_secret_value() if prepared.form_token is not None else None
    event: dict[str, JsonValue] | None = None
    outputs: dict[str, JsonValue] = {}
    edge = None
    if form.status == HumanInputFormStatus.WAITING:
        presentation = build_form_presentation(resolved)
        event = HumanInputRequiredResponse.Data(
            form_version=form.form_version,
            form_id=form.id,
            node_id=node_id,
            node_title=resolved.title,
            form_content=presentation.form_content,
            inputs=presentation.inputs,
            actions=presentation.user_actions,
            display_in_ui=token is not None,
            form_token=token,
            resolved_default_values=presentation.resolved_default_values,
            expiration_time=to_timestamp(min(form.expiration_time, form.global_timeout_deadline)),
        ).model_dump(mode="json")
    elif form.status == HumanInputFormStatus.SUBMITTED:
        submission = form.submission
        assert submission is not None
        action = next(action for action in resolved.actions if action.id == submission.selected_action_id)
        content = render_filled_content(resolved, submission.normalized_submission_data)
        submitted_data = TypeAdapter(dict[str, JsonValue]).validate_json(
            TypeAdapter(dict[str, object]).dump_json(
                {name: segment.to_object() for name, segment in submission.normalized_submission_data.items()}
            )
        )
        outputs = dict(submitted_data)
        outputs.update(__action_id=action.id, __action_value=action.title, __rendered_content=content)
        edge = action.id
        event = {
            "form_id": form.id,
            "node_id": node_id,
            "node_title": resolved.title,
            "rendered_content": content,
            "action_id": action.id,
            "action_text": action.title,
            "submitted_data": submitted_data,
        }
    elif form.status == HumanInputFormStatus.TIMEOUT:
        outputs = {"__action_id": "", "__action_value": "", "__rendered_content": resolved.legacy_form_content}
        edge = "__timeout"
        event = {
            "form_id": form.id,
            "node_id": node_id,
            "node_title": resolved.title,
            "expiration_time": to_timestamp(form.expiration_time),
        }
    return {
        "status": form.status.value,
        "form_id": form.id,
        "session_id": form.id if form.form_version == "1" else f"hitlv2:{form.id}",
        "form_token": token if form.status == HumanInputFormStatus.WAITING else None,
        "event": event,
        "outputs": outputs,
        "output_segments": {
            name: segment.model_dump(mode="json")
            for name, segment in form.submission.normalized_submission_data.items()
        }
        if form.submission is not None
        else {},
        "edge_source_handle": edge,
        "node_title": resolved.title,
        "expire_reason": f"Human input form globally expired: {form.id}"
        if form.status == HumanInputFormStatus.EXPIRED
        else None,
    }
