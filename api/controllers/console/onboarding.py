"""Console onboarding APIs.

This module keeps Step-by-step Tour persistence account-scoped. Workspace IDs
are accepted only as presentation overrides; UI-only state such as minimized
panels or the currently active task stays on the frontend. PATCH requests are
action-based so callers do not replace server-side arrays with stale snapshots.
"""

from datetime import datetime
from typing import Literal, cast

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, model_validator

from controllers.common.schema import register_response_schema_models, register_schema_models
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from models import Account
from services.step_by_step_tour_service import StepByStepTourPatch, StepByStepTourService

from . import console_ns
from .wraps import account_initialization_required, setup_required, with_current_tenant_id, with_current_user

StepByStepTourAction = Literal[
    "skip",
    "complete_task",
    "uncomplete_task",
    "enable_current_workspace",
    "disable_current_workspace",
]
StepByStepTourTaskId = Literal["home", "studio", "knowledge", "integration"]


class StepByStepTourStatePatchPayload(BaseModel):
    action: StepByStepTourAction = Field(description="State update action")
    task_id: StepByStepTourTaskId | None = Field(default=None, description="Task ID for task actions")

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_patch_shape(self) -> "StepByStepTourStatePatchPayload":
        task_actions = {"complete_task", "uncomplete_task"}
        if self.action in task_actions and self.task_id is None:
            raise ValueError("task_id is required for task actions")
        if self.action not in task_actions and self.task_id is not None:
            raise ValueError("task_id is only supported for task actions")

        return self


class StepByStepTourStateResponse(ResponseModel):
    first_workspace_id: str | None = None
    skipped: bool = False
    completed_task_ids: list[StepByStepTourTaskId] = Field(default_factory=list)
    manually_enabled_workspace_ids: list[str] = Field(default_factory=list)
    manually_disabled_workspace_ids: list[str] = Field(default_factory=list)
    updated_at: datetime | None = None


register_schema_models(console_ns, StepByStepTourStatePatchPayload)
register_response_schema_models(console_ns, StepByStepTourStateResponse)


@console_ns.route("/onboarding/step-by-step-tour/state")
class StepByStepTourStateApi(Resource):
    @console_ns.doc("get_step_by_step_tour_state")
    @console_ns.doc(description="Get account-level Step-by-step Tour state")
    @console_ns.response(200, "Success", console_ns.models[StepByStepTourStateResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        return dump_response(
            StepByStepTourStateResponse,
            StepByStepTourService.get_state(
                account=current_user,
                current_tenant_id=current_tenant_id,
                session=db.session,
            ),
        )

    @console_ns.doc("patch_step_by_step_tour_state")
    @console_ns.doc(description="Update account-level Step-by-step Tour state")
    @console_ns.expect(console_ns.models[StepByStepTourStatePatchPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[StepByStepTourStateResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def patch(self, current_tenant_id: str, current_user: Account):
        payload = StepByStepTourStatePatchPayload.model_validate(console_ns.payload or {})
        patch = cast(StepByStepTourPatch, payload.model_dump(exclude_unset=True, exclude_none=True))
        return dump_response(
            StepByStepTourStateResponse,
            StepByStepTourService.patch_state(
                account=current_user,
                current_tenant_id=current_tenant_id,
                patch=patch,
                session=db.session,
            ),
        )
