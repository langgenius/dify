"""Agent App presentation-feature configuration endpoint.

The new Agent App type keeps model / prompt / tools in its bound Agent Soul, so
the legacy ``/model-config`` surface (which writes model, prompt and agent tool
config) is the wrong place to configure its app-level presentation features.
This endpoint exposes only the PRD "Misc Legacy" feature subset — conversation
opener, follow-up suggestions, citations, content moderation and speech — and
persists them onto the app's ``app_model_config`` without touching anything the
Soul owns.
"""

from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import AgentId, RBACCheck
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, validate_request
from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from models.account import TenantAccountRole
from models.agent_config_entities import (
    AgentFeatureToggleConfig,
    AgentSensitiveWordAvoidanceFeatureConfig,
    AgentSuggestedQuestionsAfterAnswerFeatureConfig,
    AgentTextToSpeechFeatureConfig,
)
from services.agent.errors import AgentNotFoundError
from services.app.agent_app_contracts import AgentAppNotFoundError


class AgentAppFeaturesPayload(BaseModel):
    """Presentation features configurable on an Agent App.

    All fields are optional; an omitted field is reset to its disabled/empty
    default (the config form sends the full desired feature state on save).
    """

    opening_statement: str | None = Field(default=None, description="Conversation opener shown before the first turn")
    suggested_questions: list[str] | None = Field(
        default=None, description="Preset questions shown alongside the opener"
    )
    suggested_questions_after_answer: AgentSuggestedQuestionsAfterAnswerFeatureConfig | None = Field(
        default=None, description="Follow-up suggestions config, e.g. {'enabled': true}"
    )
    speech_to_text: AgentFeatureToggleConfig | None = Field(default=None, description="Speech-to-text config")
    text_to_speech: AgentTextToSpeechFeatureConfig | None = Field(default=None, description="Text-to-speech config")
    retriever_resource: AgentFeatureToggleConfig | None = Field(
        default=None, description="Citations / attributions config, e.g. {'enabled': true}"
    )
    sensitive_word_avoidance: AgentSensitiveWordAvoidanceFeatureConfig | None = Field(
        default=None, description="Content moderation config"
    )


register_schema_models(console_ns, AgentAppFeaturesPayload)
register_response_schema_models(console_ns, SimpleResultResponse)


@console_ns.route("/agent/<uuid:agent_id>/features")
class AgentAppFeatureConfigResource(Resource):
    @console_ns.doc("update_agent_app_features")
    @console_ns.doc(description="Update an Agent App's presentation features (opener, follow-up, citations, ...)")
    @console_ns.doc(params={"agent_id": "Agent ID"})
    @console_ns.expect(console_ns.models[AgentAppFeaturesPayload.__name__])
    @console_ns.response(200, "Features updated successfully", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(400, "Invalid configuration")
    @console_ns.response(404, "Agent not found")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=(RBACCheck(RBACPermission.AGENT_EDIT, AgentId()),),
    )
    def post(self, context: RequestContext, agent_id: UUID):
        payload = validate_request(AgentAppFeaturesPayload)
        try:
            application_services().agent_apps.features.update_features(
                context, str(agent_id), payload.model_dump(exclude_none=True)
            )
        except AgentAppNotFoundError as exc:
            raise AgentNotFoundError from exc
        return SimpleResultResponse(result="success").model_dump(mode="json")
