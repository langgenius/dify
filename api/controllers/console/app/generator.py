import json
from collections.abc import Generator, Sequence
from typing import Any, Literal

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, RootModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.common.fields import SimpleDataResponse
from controllers.common.schema import register_enum_models, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.app.wraps import with_session
from controllers.console.wraps import account_initialization_required, setup_required, with_current_tenant_id
from core.app.app_config.entities import ModelConfig
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.helper.code_executor.code_node_provider import CodeNodeProvider
from core.helper.code_executor.javascript.javascript_code_provider import JavascriptCodeProvider
from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider
from core.llm_generator.entities import RuleCodeGeneratePayload, RuleGeneratePayload, RuleStructuredOutputPayload
from core.llm_generator.llm_generator import LLMGenerator
from core.workflow.generator.types import WorkflowGenerateErrorCode
from fields.base import ResponseModel
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.errors.invoke import InvokeError
from libs.helper import compact_generate_response, dump_response
from libs.login import login_required
from models import App
from services.workflow_generator_service import WorkflowGeneratorService
from services.workflow_service import WorkflowService


class InstructionGeneratePayload(BaseModel):
    flow_id: str = Field(..., description="Workflow/Flow ID")
    node_id: str = Field(default="", description="Node ID for workflow context")
    current: str = Field(default="", description="Current instruction text")
    language: str = Field(default="javascript", description="Programming language (javascript/python)")
    instruction: str = Field(..., description="Instruction for generation")
    model_config_data: ModelConfig = Field(
        ...,
        alias="model_config",
        description="Model configuration",
    )
    ideal_output: str = Field(default="", description="Expected ideal output")


class InstructionTemplatePayload(BaseModel):
    type: str = Field(..., description="Instruction template type")


# Upper bound for the generator's free-text inputs. Generous for prose (a
# detailed instruction rarely passes 2k chars) while keeping the
# planner+builder prompts well inside every mainstream context window.
# Mirrored by the ``maxLength`` on the frontend generator textarea.
_MAX_INSTRUCTION_LENGTH = 10_000


class WorkflowGraphPosition(BaseModel):
    x: float
    y: float


class WorkflowGraphViewport(WorkflowGraphPosition):
    zoom: float


class WorkflowGraphNode(BaseModel):
    """React Flow node shape accepted and returned by the generator.

    Node-specific configuration lives under ``data`` and wrapper metadata
    differs for container children, so unknown wrapper fields must survive
    request validation and response serialization.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    type: str
    position: WorkflowGraphPosition
    data: dict[str, Any]


class WorkflowGraphEdge(BaseModel):
    """React Flow edge shape with extensible renderer metadata."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    source: str
    target: str
    type: str


class WorkflowGraph(BaseModel):
    nodes: list[WorkflowGraphNode]
    edges: list[WorkflowGraphEdge]
    viewport: WorkflowGraphViewport


class WorkflowGeneratePayload(BaseModel):
    """Payload for the cmd+k `/create` and `/refine` workflow generator endpoint.

    See ``services/workflow_generator_service.py`` for behaviour. Errors are
    surfaced through the same envelope as ``/rule-generate`` so the frontend
    can reuse its existing handler.
    """

    mode: Literal["workflow", "advanced-chat", "auto"] = Field(
        ...,
        description="Target app mode for the generated graph; 'auto' lets the backend classify the instruction",
    )
    instruction: str = Field(..., description="Natural-language workflow description")
    ideal_output: str = Field(default="", description="Optional sample output for grounding")
    model_config_data: ModelConfig = Field(
        ...,
        alias="model_config",
        description="Model configuration",
    )
    current_graph: WorkflowGraph | None = Field(
        default=None,
        description="Existing draft graph to refine (cmd+k `/refine`); omit for create-from-scratch",
    )


class WorkflowInstructionSuggestionsPayload(BaseModel):
    """Payload for the workflow-generator instruction-suggestions endpoint.

    Runs before the user picks a model, so the suggestions come from the
    tenant's default model. The underlying generator never raises — an empty
    ``suggestions`` list is a valid 200 (soft-fail).
    """

    mode: Literal["workflow", "advanced-chat"] = Field(..., description="Target app mode for the suggestions")
    language: str | None = Field(default=None, description="Optional language to write the suggestions in")
    count: int = Field(default=4, ge=1, le=6, description="Number of suggestions to return (1-6)")


class WorkflowGenerateErrorResponse(ResponseModel):
    code: WorkflowGenerateErrorCode
    detail: str
    node_id: str | None = None


class WorkflowGenerateResponse(ResponseModel):
    graph: WorkflowGraph
    message: str = ""
    app_name: str = ""
    icon: str = ""
    error: str = ""
    errors: list[WorkflowGenerateErrorResponse] = Field(default_factory=list)
    mode: Literal["workflow", "advanced-chat"] | None = None


class WorkflowPlanNodeResponse(ResponseModel):
    label: str
    node_type: str
    purpose: str = ""


class WorkflowPlanStartInputResponse(ResponseModel):
    variable: str
    label: str = ""
    type: str = ""


class WorkflowGeneratePlanEventResponse(ResponseModel):
    event: Literal["plan"] = "plan"
    title: str = ""
    description: str = ""
    app_name: str = ""
    icon: str = ""
    mode: Literal["workflow", "advanced-chat"]
    nodes: list[WorkflowPlanNodeResponse]
    start_inputs: list[WorkflowPlanStartInputResponse] = Field(default_factory=list)


class WorkflowGenerateResultEventResponse(WorkflowGenerateResponse):
    event: Literal["result"] = "result"


class WorkflowGenerateStreamEventResponse(
    RootModel[WorkflowGeneratePlanEventResponse | WorkflowGenerateResultEventResponse]
):
    """Schema for each JSON object carried by an SSE ``data:`` frame."""


class WorkflowInstructionSuggestionsResponse(ResponseModel):
    suggestions: list[str]


class GeneratorResponse(RootModel[Any]):
    root: Any


register_enum_models(console_ns, LLMMode)
register_schema_models(
    console_ns,
    RuleGeneratePayload,
    RuleCodeGeneratePayload,
    RuleStructuredOutputPayload,
    InstructionGeneratePayload,
    InstructionTemplatePayload,
    WorkflowGeneratePayload,
    WorkflowInstructionSuggestionsPayload,
    ModelConfig,
)
register_response_schema_models(
    console_ns,
    GeneratorResponse,
    SimpleDataResponse,
    WorkflowGenerateResponse,
    WorkflowGeneratePlanEventResponse,
    WorkflowGenerateResultEventResponse,
    WorkflowGenerateStreamEventResponse,
    WorkflowInstructionSuggestionsResponse,
)


@console_ns.route("/rule-generate")
class RuleGenerateApi(Resource):
    @console_ns.doc("generate_rule_config")
    @console_ns.doc(description="Generate rule configuration using LLM")
    @console_ns.expect(console_ns.models[RuleGeneratePayload.__name__])
    @console_ns.response(
        200,
        "Rule configuration generated successfully",
        console_ns.models[GeneratorResponse.__name__],
    )
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        args = RuleGeneratePayload.model_validate(console_ns.payload)

        try:
            rules = LLMGenerator.generate_rule_config(tenant_id=current_tenant_id, args=args)
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)

        return rules


@console_ns.route("/rule-code-generate")
class RuleCodeGenerateApi(Resource):
    @console_ns.doc("generate_rule_code")
    @console_ns.doc(description="Generate code rules using LLM")
    @console_ns.expect(console_ns.models[RuleCodeGeneratePayload.__name__])
    @console_ns.response(200, "Code rules generated successfully", console_ns.models[GeneratorResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        args = RuleCodeGeneratePayload.model_validate(console_ns.payload)

        try:
            code_result = LLMGenerator.generate_code(
                tenant_id=current_tenant_id,
                args=args,
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)

        return code_result


@console_ns.route("/rule-structured-output-generate")
class RuleStructuredOutputGenerateApi(Resource):
    @console_ns.doc("generate_structured_output")
    @console_ns.doc(description="Generate structured output rules using LLM")
    @console_ns.expect(console_ns.models[RuleStructuredOutputPayload.__name__])
    @console_ns.response(200, "Structured output generated successfully", console_ns.models[GeneratorResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        args = RuleStructuredOutputPayload.model_validate(console_ns.payload)

        try:
            structured_output = LLMGenerator.generate_structured_output(
                tenant_id=current_tenant_id,
                args=args,
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)

        return structured_output


@console_ns.route("/instruction-generate")
class InstructionGenerateApi(Resource):
    @console_ns.doc("generate_instruction")
    @console_ns.doc(description="Generate instruction for workflow nodes or general use")
    @console_ns.expect(console_ns.models[InstructionGeneratePayload.__name__])
    @console_ns.response(200, "Instruction generated successfully", console_ns.models[GeneratorResponse.__name__])
    @console_ns.response(400, "Invalid request parameters or flow/workflow not found")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    @with_session(write=False)
    def post(self, session: Session, current_tenant_id: str):
        args = InstructionGeneratePayload.model_validate(console_ns.payload)
        providers: list[type[CodeNodeProvider]] = [Python3CodeProvider, JavascriptCodeProvider]
        code_provider: type[CodeNodeProvider] | None = next(
            (p for p in providers if p.is_accept_language(args.language)), None
        )
        code_template = code_provider.get_default_code() if code_provider else ""
        try:
            # Generate from nothing for a workflow node
            if (args.current in (code_template, "")) and args.node_id != "":
                app = session.scalar(
                    select(App).where(App.id == args.flow_id, App.tenant_id == current_tenant_id).limit(1)
                )
                if not app:
                    return {"error": f"app {args.flow_id} not found"}, 400
                workflow = WorkflowService().get_draft_workflow(app_model=app, session=session)
                if not workflow:
                    return {"error": f"workflow {args.flow_id} not found"}, 400
                nodes: Sequence = workflow.graph_dict["nodes"]
                node = [node for node in nodes if node["id"] == args.node_id]
                if len(node) == 0:
                    return {"error": f"node {args.node_id} not found"}, 400
                node_type = node[0]["data"]["type"]
                match node_type:
                    case "llm":
                        return LLMGenerator.generate_rule_config(
                            current_tenant_id,
                            args=RuleGeneratePayload(
                                instruction=args.instruction,
                                model_config=args.model_config_data,
                                no_variable=True,
                            ),
                        )
                    case "agent":
                        return LLMGenerator.generate_rule_config(
                            current_tenant_id,
                            args=RuleGeneratePayload(
                                instruction=args.instruction,
                                model_config=args.model_config_data,
                                no_variable=True,
                            ),
                        )
                    case "code":
                        return LLMGenerator.generate_code(
                            tenant_id=current_tenant_id,
                            args=RuleCodeGeneratePayload(
                                instruction=args.instruction,
                                model_config=args.model_config_data,
                                code_language=args.language,
                            ),
                        )
                    case _:
                        return {"error": f"invalid node type: {node_type}"}
            if args.node_id == "" and args.current != "":  # For legacy app without a workflow
                return LLMGenerator.instruction_modify_legacy(
                    tenant_id=current_tenant_id,
                    flow_id=args.flow_id,
                    current=args.current,
                    instruction=args.instruction,
                    model_config=args.model_config_data,
                    ideal_output=args.ideal_output,
                )
            if args.node_id != "" and args.current != "":  # For workflow node
                return LLMGenerator.instruction_modify_workflow(
                    tenant_id=current_tenant_id,
                    flow_id=args.flow_id,
                    node_id=args.node_id,
                    current=args.current,
                    instruction=args.instruction,
                    model_config=args.model_config_data,
                    ideal_output=args.ideal_output,
                    workflow_service=WorkflowService(),
                )
            return {"error": "incompatible parameters"}, 400
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)


@console_ns.route("/instruction-generate/template")
class InstructionGenerationTemplateApi(Resource):
    @console_ns.doc("get_instruction_template")
    @console_ns.doc(description="Get instruction generation template")
    @console_ns.expect(console_ns.models[InstructionTemplatePayload.__name__])
    @console_ns.response(200, "Template retrieved successfully", console_ns.models[SimpleDataResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        args = InstructionTemplatePayload.model_validate(console_ns.payload)
        match args.type:
            case "prompt":
                from core.llm_generator.prompts import INSTRUCTION_GENERATE_TEMPLATE_PROMPT

                return {"data": INSTRUCTION_GENERATE_TEMPLATE_PROMPT}
            case "code":
                from core.llm_generator.prompts import INSTRUCTION_GENERATE_TEMPLATE_CODE

                return {"data": INSTRUCTION_GENERATE_TEMPLATE_CODE}
            case _:
                raise ValueError(f"Invalid type: {args.type}")


def _workflow_instruction_guard(args: WorkflowGeneratePayload) -> tuple[dict, int] | None:
    """Shared boundary guard for the workflow-generate endpoints.

    Returns a ``(body, 400)`` tuple when the instruction is empty / whitespace
    or either free-text field exceeds the cap, else ``None``. Pydantic only
    validates the field is a str; a whitespace-only or pasted-document input
    would otherwise waste a slow planner+builder roundtrip on a response the
    validator rejects anyway. Both the blocking and streaming endpoints call
    this so they reject identical inputs.
    """
    if not args.instruction.strip():
        return {
            "error": "Instruction is required",
            "errors": [{"code": WorkflowGenerateErrorCode.EMPTY_INSTRUCTION, "detail": "Instruction is required"}],
        }, 400
    if len(args.instruction) > _MAX_INSTRUCTION_LENGTH or len(args.ideal_output) > _MAX_INSTRUCTION_LENGTH:
        return {
            "error": "Instruction is too long",
            "errors": [
                {
                    "code": WorkflowGenerateErrorCode.INSTRUCTION_TOO_LONG,
                    "detail": f"Instruction and ideal output must each be at most {_MAX_INSTRUCTION_LENGTH} characters",
                }
            ],
        }, 400
    return None


@console_ns.route("/workflow-generate")
class WorkflowGenerateApi(Resource):
    """Generate a Workflow / Chatflow draft graph from a natural-language description.

    Triggered by the cmd+k `/create` slash command. Returns a graph payload
    shaped exactly like ``WorkflowService.sync_draft_workflow``'s input, so the
    frontend can hand it straight to ``/apps/{id}/workflows/draft``.
    """

    @console_ns.doc("generate_workflow_graph")
    @console_ns.doc(description="Generate a Dify workflow graph from natural language")
    @console_ns.expect(console_ns.models[WorkflowGeneratePayload.__name__])
    @console_ns.response(
        200,
        "Workflow graph generated successfully",
        console_ns.models[WorkflowGenerateResponse.__name__],
    )
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        args = WorkflowGeneratePayload.model_validate(console_ns.payload)

        # Reject empty / over-length instructions at the boundary (shared with
        # the streaming endpoint) before spending a planner+builder roundtrip.
        guard = _workflow_instruction_guard(args)
        if guard is not None:
            return guard

        try:
            result = WorkflowGeneratorService.generate_workflow_graph(
                tenant_id=current_tenant_id,
                mode=args.mode,
                instruction=args.instruction,
                model_config=args.model_config_data,
                ideal_output=args.ideal_output,
                current_graph=args.current_graph.model_dump(by_alias=True, exclude_none=True)
                if args.current_graph
                else None,
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)

        return dump_response(WorkflowGenerateResponse, result)


@console_ns.route("/workflow-generate/suggestions")
class WorkflowInstructionSuggestionsApi(Resource):
    """Suggest short, buildable example instructions for the cmd+k generator.

    Runs before a model is selected (uses the tenant's default model). The
    underlying generator never raises, so an empty list is a valid 200 — the
    frontend renders "no suggestions" rather than an error, so no provider-error
    mapping is needed here.
    """

    @console_ns.doc("generate_workflow_instruction_suggestions")
    @console_ns.doc(description="Suggest example workflow-generator instructions for the tenant")
    @console_ns.expect(console_ns.models[WorkflowInstructionSuggestionsPayload.__name__])
    @console_ns.response(
        200,
        "Suggestions generated successfully",
        console_ns.models[WorkflowInstructionSuggestionsResponse.__name__],
    )
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        args = WorkflowInstructionSuggestionsPayload.model_validate(console_ns.payload)
        suggestions = LLMGenerator.generate_workflow_instruction_suggestions(
            tenant_id=current_tenant_id,
            mode=args.mode,
            language=args.language,
            count=args.count,
        )
        return dump_response(WorkflowInstructionSuggestionsResponse, {"suggestions": suggestions})


@console_ns.route("/workflow-generate/stream")
class WorkflowGenerateStreamApi(Resource):
    """Plan-first streaming variant of ``/workflow-generate`` (Server-Sent Events).

    Emits a ``plan`` event (high-level node list + app metadata) as soon as the
    planner returns, then a final ``result`` event with the full graph — the
    SAME envelope ``/workflow-generate`` returns. Provider-init / invoke errors
    are surfaced as a single ``result`` event (code ``MODEL_ERROR``) so the
    frontend's stream parser always receives a result rather than a non-SSE HTTP
    error.
    """

    @console_ns.doc("generate_workflow_graph_stream")
    @console_ns.doc(description="Stream a Dify workflow graph (plan then result) via SSE")
    @console_ns.expect(console_ns.models[WorkflowGeneratePayload.__name__])
    @console_ns.response(
        200,
        "Server-Sent Events stream; each data frame matches this plan/result event schema",
        console_ns.models[WorkflowGenerateStreamEventResponse.__name__],
    )
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        args = WorkflowGeneratePayload.model_validate(console_ns.payload)

        # Same boundary guards as the blocking endpoint — return a normal 400
        # JSON for these BEFORE opening the stream.
        guard = _workflow_instruction_guard(args)
        if guard is not None:
            return guard

        def generate() -> Generator[str, None, None]:
            try:
                for event_name, payload in WorkflowGeneratorService.generate_workflow_graph_stream(
                    tenant_id=current_tenant_id,
                    mode=args.mode,
                    instruction=args.instruction,
                    model_config=args.model_config_data,
                    ideal_output=args.ideal_output,
                    current_graph=(
                        args.current_graph.model_dump(by_alias=True, exclude_none=True) if args.current_graph else None
                    ),
                ):
                    body = {"event": event_name, **payload}
                    if event_name == "plan":
                        plan_event = WorkflowGeneratePlanEventResponse.model_validate(body)
                        yield f"data: {json.dumps(plan_event.model_dump(mode='json'))}\n\n"
                    else:
                        result_event = WorkflowGenerateResultEventResponse.model_validate(body)
                        yield f"data: {json.dumps(result_event.model_dump(mode='json'))}\n\n"
            except (ProviderTokenNotInitError, QuotaExceededError, ModelCurrentlyNotSupportError, InvokeError) as e:
                # The model instance is resolved inside the service (lazily, on
                # first iteration), so a provider / init error surfaces here.
                # Emit it as a single SSE result event rather than a non-SSE
                # error response so the frontend's stream parser always gets a
                # result it can render.
                detail = getattr(e, "description", None) or str(e) or "Model invocation failed"
                error_body = {
                    "event": "result",
                    "graph": {"nodes": [], "edges": [], "viewport": {"x": 0.0, "y": 0.0, "zoom": 0.7}},
                    "error": detail,
                    "errors": [{"code": WorkflowGenerateErrorCode.MODEL_ERROR, "detail": detail}],
                }
                error_event = WorkflowGenerateResultEventResponse.model_validate(error_body)
                yield f"data: {json.dumps(error_event.model_dump(mode='json'))}\n\n"

        return compact_generate_response(generate())
