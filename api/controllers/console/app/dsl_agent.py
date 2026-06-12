from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from libs.login import current_account_with_tenant, login_required
from models.model import AppMode
from services.app_dsl_agent_service import (
    DEFAULT_APP_MODE,
    DEFAULT_INPUT_VARIABLE,
    DEFAULT_MODEL_NAME,
    DEFAULT_MODEL_PROVIDER,
    GENERATION_BACKEND_OPENAI,
    AppDslAgentDebugRunArgs,
    AppDslAgentDebugService,
    AppDslAgentGenerateArgs,
    AppDslAgentRepairArgs,
    AppDslAgentService,
    app_dsl_agent_run_store,
    normalize_generation_backend,
    serialize_run,
)

from .. import console_ns

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class AppDslAgentGeneratePayload(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    app_name: str | None = Field(None, max_length=80)
    app_description: str | None = Field(None, max_length=240)
    app_mode: str = Field(DEFAULT_APP_MODE, max_length=32)
    provider: str = Field(DEFAULT_MODEL_PROVIDER, max_length=255)
    model: str = Field(DEFAULT_MODEL_NAME, max_length=255)
    generation_backend: str | None = Field(None, max_length=64)
    generation_model: str | None = Field(None, max_length=255)
    input_variable: str = Field(DEFAULT_INPUT_VARIABLE, max_length=64)
    marketplace_plugin_id: str | None = Field(None, max_length=255)
    resolve_dependencies: bool = Field(True)


class AppDslAgentDebugRunPayload(BaseModel):
    inputs: dict = Field(default_factory=dict)
    query: str = Field("", max_length=8000)
    files: list[dict] | None = None
    include_events: bool = Field(False)


class AppDslAgentRepairPayload(BaseModel):
    yaml_content: str = Field(..., min_length=1)
    runtime_evidence: dict = Field(default_factory=dict)
    validation: dict | None = None


class AppDslAgentDraftRepairPayload(AppDslAgentDebugRunPayload):
    yaml_content: str = Field(..., min_length=1)
    validation: dict | None = None


console_ns.schema_model(
    AppDslAgentGeneratePayload.__name__,
    AppDslAgentGeneratePayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)
console_ns.schema_model(
    AppDslAgentDebugRunPayload.__name__,
    AppDslAgentDebugRunPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)
console_ns.schema_model(
    AppDslAgentRepairPayload.__name__,
    AppDslAgentRepairPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)
console_ns.schema_model(
    AppDslAgentDraftRepairPayload.__name__,
    AppDslAgentDraftRepairPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@console_ns.route("/apps/dsl-agent/generate")
class AppDslAgentGenerateApi(Resource):
    @console_ns.expect(console_ns.models[AppDslAgentGeneratePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self):
        args = AppDslAgentGeneratePayload.model_validate(console_ns.payload or {})
        if normalize_generation_backend(args.generation_backend) == GENERATION_BACKEND_OPENAI:
            raise BadRequest("OpenAI DSL generation must use /console/api/apps/dsl-agent/runs.")
        result = AppDslAgentService().generate(
            AppDslAgentGenerateArgs(
                prompt=args.prompt,
                app_name=args.app_name,
                app_description=args.app_description,
                app_mode=args.app_mode,
                provider=args.provider,
                model=args.model,
                generation_backend=args.generation_backend,
                generation_model=args.generation_model,
                input_variable=args.input_variable,
                marketplace_plugin_id=args.marketplace_plugin_id,
                resolve_dependencies=args.resolve_dependencies,
            )
        )
        return {
            "yaml_content": result.yaml_content,
            "name": result.name,
            "description": result.description,
            "warnings": result.warnings,
            "metadata": result.metadata,
        }, 200


@console_ns.route("/apps/dsl-agent/runs")
class AppDslAgentRunsApi(Resource):
    @console_ns.expect(console_ns.models[AppDslAgentGeneratePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self):
        args = AppDslAgentGeneratePayload.model_validate(console_ns.payload or {})
        current_user, current_tenant_id = current_account_with_tenant()
        run = app_dsl_agent_run_store.create_run(
            AppDslAgentGenerateArgs(
                prompt=args.prompt,
                app_name=args.app_name,
                app_description=args.app_description,
                app_mode=args.app_mode,
                provider=args.provider,
                model=args.model,
                generation_backend=args.generation_backend,
                generation_model=args.generation_model,
                input_variable=args.input_variable,
                marketplace_plugin_id=args.marketplace_plugin_id,
                resolve_dependencies=args.resolve_dependencies,
            ),
            account_id=current_user.id,
            tenant_id=current_tenant_id,
        )
        return serialize_run(run), 202


@console_ns.route("/apps/dsl-agent/runs/<string:run_id>")
class AppDslAgentRunApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, run_id: str):
        current_user, current_tenant_id = current_account_with_tenant()
        run = app_dsl_agent_run_store.get_run(
            run_id,
            account_id=current_user.id,
            tenant_id=current_tenant_id,
        )
        if not run:
            raise NotFound("DSL agent run not found")
        return serialize_run(run), 200


@console_ns.route("/apps/dsl-agent/debug/repair")
class AppDslAgentDebugRepairApi(Resource):
    @console_ns.expect(console_ns.models[AppDslAgentRepairPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self):
        args = AppDslAgentRepairPayload.model_validate(console_ns.payload or {})
        result = AppDslAgentDebugService().repair_yaml(
            AppDslAgentRepairArgs(
                yaml_content=args.yaml_content,
                runtime_evidence=args.runtime_evidence,
                validation=args.validation,
            )
        )
        return result, 200


@console_ns.route("/apps/<uuid:app_id>/dsl-agent/debug/draft-run")
class AppDslAgentDraftDebugRunApi(Resource):
    @console_ns.expect(console_ns.models[AppDslAgentDebugRunPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @edit_permission_required
    def post(self, app_model):
        current_user, _ = current_account_with_tenant()
        args = AppDslAgentDebugRunPayload.model_validate(console_ns.payload or {})
        result = AppDslAgentDebugService().run_draft_workflow(
            app_model=app_model,
            account=current_user,
            args=AppDslAgentDebugRunArgs(
                inputs=args.inputs,
                query=args.query,
                files=args.files,
                include_events=args.include_events,
            ),
        )
        return result, 200


@console_ns.route("/apps/<uuid:app_id>/dsl-agent/debug/repair-draft")
class AppDslAgentDraftDebugRepairApi(Resource):
    @console_ns.expect(console_ns.models[AppDslAgentDraftRepairPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @edit_permission_required
    def post(self, app_model):
        current_user, _ = current_account_with_tenant()
        args = AppDslAgentDraftRepairPayload.model_validate(console_ns.payload or {})
        result = AppDslAgentDebugService().run_draft_workflow_and_repair(
            app_model=app_model,
            account=current_user,
            yaml_content=args.yaml_content,
            validation=args.validation,
            args=AppDslAgentDebugRunArgs(
                inputs=args.inputs,
                query=args.query,
                files=args.files,
                include_events=args.include_events,
            ),
        )
        return result, 200
