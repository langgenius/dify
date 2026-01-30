from collections.abc import Sequence
from typing import Any

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.console import console_ns
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.wraps import account_initialization_required, setup_required
from core.app.app_config.entities import ModelConfig
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.helper.code_executor.code_node_provider import CodeNodeProvider
from core.helper.code_executor.javascript.javascript_code_provider import JavascriptCodeProvider
from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider
from core.llm_generator.context_models import (
    AvailableVarPayload,
    CodeContextPayload,
    ParameterInfoPayload,
)
from core.llm_generator.entities import RuleCodeGeneratePayload, RuleGeneratePayload, RuleStructuredOutputPayload
from core.llm_generator.llm_generator import LLMGenerator
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models import App
from services.workflow_service import WorkflowService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class InstructionGeneratePayload(BaseModel):
    flow_id: str = Field(..., description="Workflow/Flow ID")
    node_id: str = Field(default="", description="Node ID for workflow context")
    current: str = Field(default="", description="Current instruction text")
    language: str = Field(default="javascript", description="Programming language (javascript/python)")
    instruction: str = Field(..., description="Instruction for generation")
    model_config_data: ModelConfig = Field(..., alias="model_config", description="Model configuration")
    ideal_output: str = Field(default="", description="Expected ideal output")


class InstructionTemplatePayload(BaseModel):
    type: str = Field(..., description="Instruction template type")


class ContextGeneratePayload(BaseModel):
    """Payload for generating extractor code node."""

    language: str = Field(default="python3", description="Code language (python3/javascript)")
    prompt_messages: list[dict[str, Any]] = Field(
        ..., description="Multi-turn conversation history, last message is the current instruction"
    )
    model_config_data: dict[str, Any] = Field(..., alias="model_config", description="Model configuration")
    available_vars: list[AvailableVarPayload] = Field(..., description="Available variables from upstream nodes")
    parameter_info: ParameterInfoPayload = Field(..., description="Target parameter metadata from the frontend")
    code_context: CodeContextPayload = Field(description="Existing code node context for incremental generation")


class SuggestedQuestionsPayload(BaseModel):
    """Payload for generating suggested questions."""

    language: str = Field(
        default="English", description="Language for generated questions (e.g. English, Chinese, Japanese)"
    )
    model_config_data: dict[str, Any] = Field(
        default_factory=dict,
        alias="model_config",
        description="Model configuration (optional, uses system default if not provided)",
    )
    available_vars: list[AvailableVarPayload] = Field(..., description="Available variables from upstream nodes")
    parameter_info: ParameterInfoPayload = Field(..., description="Target parameter metadata from the frontend")


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(RuleGeneratePayload)
reg(RuleCodeGeneratePayload)
reg(RuleStructuredOutputPayload)
reg(InstructionGeneratePayload)
reg(InstructionTemplatePayload)
reg(ContextGeneratePayload)
reg(SuggestedQuestionsPayload)
reg(ModelConfig)


@console_ns.route("/rule-generate")
class RuleGenerateApi(Resource):
    @console_ns.doc("generate_rule_config")
    @console_ns.doc(description="Generate rule configuration using LLM")
    @console_ns.expect(console_ns.models[RuleGeneratePayload.__name__])
    @console_ns.response(200, "Rule configuration generated successfully")
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        args = RuleGeneratePayload.model_validate(console_ns.payload)
        _, current_tenant_id = current_account_with_tenant()

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
    @console_ns.response(200, "Code rules generated successfully")
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        args = RuleCodeGeneratePayload.model_validate(console_ns.payload)
        _, current_tenant_id = current_account_with_tenant()

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
    @console_ns.response(200, "Structured output generated successfully")
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        args = RuleStructuredOutputPayload.model_validate(console_ns.payload)
        _, current_tenant_id = current_account_with_tenant()

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
    @console_ns.response(200, "Instruction generated successfully")
    @console_ns.response(400, "Invalid request parameters or flow/workflow not found")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        args = InstructionGeneratePayload.model_validate(console_ns.payload)
        _, current_tenant_id = current_account_with_tenant()
        providers: list[type[CodeNodeProvider]] = [Python3CodeProvider, JavascriptCodeProvider]
        code_provider: type[CodeNodeProvider] | None = next(
            (p for p in providers if p.is_accept_language(args.language)), None
        )
        code_template = code_provider.get_default_code() if code_provider else ""
        try:
            # Generate from nothing for a workflow node
            if (args.current in (code_template, "")) and args.node_id != "":
                app = db.session.query(App).where(App.id == args.flow_id).first()
                if not app:
                    return {"error": f"app {args.flow_id} not found"}, 400
                workflow = WorkflowService().get_draft_workflow(app_model=app)
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
    @console_ns.response(200, "Template retrieved successfully")
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


@console_ns.route("/context-generate")
class ContextGenerateApi(Resource):
    @console_ns.doc("generate_with_context")
    @console_ns.doc(description="Generate with multi-turn conversation context")
    @console_ns.expect(console_ns.models[ContextGeneratePayload.__name__])
    @console_ns.response(200, "Content generated successfully")
    @console_ns.response(400, "Invalid request parameters or workflow not found")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        from core.llm_generator.utils import deserialize_prompt_messages

        args = ContextGeneratePayload.model_validate(console_ns.payload)
        _, current_tenant_id = current_account_with_tenant()

        try:
            return LLMGenerator.generate_with_context(
                tenant_id=current_tenant_id,
                language=args.language,
                prompt_messages=deserialize_prompt_messages(args.prompt_messages),
                model_config=args.model_config_data,
                available_vars=args.available_vars,
                parameter_info=args.parameter_info,
                code_context=args.code_context,
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)


@console_ns.route("/context-generate/suggested-questions")
class SuggestedQuestionsApi(Resource):
    @console_ns.doc("generate_suggested_questions")
    @console_ns.doc(description="Generate suggested questions for context generation")
    @console_ns.expect(console_ns.models[SuggestedQuestionsPayload.__name__])
    @console_ns.response(200, "Questions generated successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        args = SuggestedQuestionsPayload.model_validate(console_ns.payload)
        _, current_tenant_id = current_account_with_tenant()
        try:
            return LLMGenerator.generate_suggested_questions(
                tenant_id=current_tenant_id,
                language=args.language,
                available_vars=args.available_vars,
                parameter_info=args.parameter_info,
                model_config=args.model_config_data,
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
