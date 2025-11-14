from flask_restx import Resource, fields, reqparse

from controllers.console import api, console_ns
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.wraps import account_initialization_required, setup_required
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.llm_generator.llm_generator import LLMGenerator
from core.model_runtime.errors.invoke import InvokeError
from libs.login import current_account_with_tenant, login_required
from services.workflow_service import WorkflowService


@console_ns.route("/rule-generate")
class RuleGenerateApi(Resource):
    @api.doc("generate_rule_config")
    @api.doc(description="Generate rule configuration using LLM")
    @api.expect(
        api.model(
            "RuleGenerateRequest",
            {
                "instruction": fields.String(required=True, description="Rule generation instruction"),
                "model_config": fields.Raw(required=True, description="Model configuration"),
                "no_variable": fields.Boolean(required=True, default=False, description="Whether to exclude variables"),
            },
        )
    )
    @api.response(200, "Rule configuration generated successfully")
    @api.response(400, "Invalid request parameters")
    @api.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("instruction", type=str, required=True, nullable=False, location="json")
            .add_argument("model_config", type=dict, required=True, nullable=False, location="json")
            .add_argument("no_variable", type=bool, required=True, default=False, location="json")
        )
        args = parser.parse_args()
        _, current_tenant_id = current_account_with_tenant()

        try:
            rules = LLMGenerator.generate_rule_config(
                tenant_id=current_tenant_id,
                instruction=args["instruction"],
                model_config=args["model_config"],
                no_variable=args["no_variable"],
            )
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
    @api.doc("generate_rule_code")
    @api.doc(description="Generate code rules using LLM")
    @api.expect(
        api.model(
            "RuleCodeGenerateRequest",
            {
                "instruction": fields.String(required=True, description="Code generation instruction"),
                "model_config": fields.Raw(required=True, description="Model configuration"),
                "no_variable": fields.Boolean(required=True, default=False, description="Whether to exclude variables"),
                "code_language": fields.String(
                    default="javascript", description="Programming language for code generation"
                ),
            },
        )
    )
    @api.response(200, "Code rules generated successfully")
    @api.response(400, "Invalid request parameters")
    @api.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("instruction", type=str, required=True, nullable=False, location="json")
            .add_argument("model_config", type=dict, required=True, nullable=False, location="json")
            .add_argument("no_variable", type=bool, required=True, default=False, location="json")
            .add_argument("code_language", type=str, required=False, default="javascript", location="json")
        )
        args = parser.parse_args()
        _, current_tenant_id = current_account_with_tenant()

        try:
            code_result = LLMGenerator.generate_code(
                tenant_id=current_tenant_id,
                instruction=args["instruction"],
                model_config=args["model_config"],
                code_language=args["code_language"],
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
    @api.doc("generate_structured_output")
    @api.doc(description="Generate structured output rules using LLM")
    @api.expect(
        api.model(
            "StructuredOutputGenerateRequest",
            {
                "instruction": fields.String(required=True, description="Structured output generation instruction"),
                "model_config": fields.Raw(required=True, description="Model configuration"),
            },
        )
    )
    @api.response(200, "Structured output generated successfully")
    @api.response(400, "Invalid request parameters")
    @api.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("instruction", type=str, required=True, nullable=False, location="json")
            .add_argument("model_config", type=dict, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()
        _, current_tenant_id = current_account_with_tenant()

        try:
            structured_output = LLMGenerator.generate_structured_output(
                tenant_id=current_tenant_id,
                instruction=args["instruction"],
                model_config=args["model_config"],
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
    @api.doc("generate_instruction")
    @api.doc(description="Generate instruction for workflow nodes or general use")
    @api.expect(
        api.model(
            "InstructionGenerateRequest",
            {
                "type": fields.String(
                    required=True,
                    description="Request type",
                    enum=[
                        "legacy_prompt_generate",
                        "workflow_prompt_generate",
                        "workflow_code_generate",
                        "workflow_prompt_edit",
                        "workflow_code_edit",
                        "memory_template_generate",
                        "memory_instruction_generate",
                        "memory_template_edit",
                        "memory_instruction_edit",
                    ]
                ),
                "flow_id": fields.String(description="Workflow/Flow ID"),
                "node_id": fields.String(description="Node ID (optional)"),
                "current": fields.String(description="Current content"),
                "language": fields.String(
                    default="javascript",
                    description="Programming language (javascript/python)"
                ),
                "instruction": fields.String(required=True, description="User instruction"),
                "model_config": fields.Raw(required=True, description="Model configuration"),
                "ideal_output": fields.String(description="Expected ideal output"),
            },
        )
    )
    @api.response(200, "Instruction generated successfully")
    @api.response(400, "Invalid request parameters or flow/workflow not found")
    @api.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("type", type=str, required=True, nullable=False, location="json")
            .add_argument("flow_id", type=str, required=False, default="", location="json")
            .add_argument("node_id", type=str, required=False, default="", location="json")
            .add_argument("current", type=str, required=False, default="", location="json")
            .add_argument("language", type=str, required=False, default="javascript", location="json")
            .add_argument("instruction", type=str, required=True, nullable=False, location="json")
            .add_argument("model_config", type=dict, required=True, nullable=False, location="json")
            .add_argument("ideal_output", type=str, required=False, default="", location="json")
        )
        args = parser.parse_args()
        _, current_tenant_id = current_account_with_tenant()

        try:
            # Validate parameters
            is_valid, error_message = self._validate_params(args["type"], args)
            if not is_valid:
                return {"error": error_message}, 400

            # Route based on type
            return self._handle_by_type(args["type"], args, current_tenant_id)

        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)

    def _validate_params(self, request_type: str, args: dict) -> tuple[bool, str]:
        """
        Validate request parameters

        Returns:
            (is_valid, error_message)
        """
        # All types require instruction and model_config
        if not args.get("instruction"):
            return False, "instruction is required"
        if not args.get("model_config"):
            return False, "model_config is required"

        # Edit types require flow_id and current
        if request_type.endswith("_edit"):
            if not args.get("flow_id"):
                return False, f"{request_type} requires flow_id"
            if not args.get("current"):
                return False, f"{request_type} requires current content"

        # Code generate requires language
        if request_type == "workflow_code_generate":
            if args.get("language") not in ["python", "javascript"]:
                return False, "language must be 'python' or 'javascript'"

        return True, ""

    def _handle_by_type(self, request_type: str, args: dict, tenant_id: str):
        """
        Route handling based on type
        """
        match request_type:
            case "legacy_prompt_generate":
                # Legacy prompt generation doesn't exist, this is actually an edit
                if not args.get("flow_id"):
                    return {"error": "legacy_prompt_generate requires flow_id"}, 400
                return LLMGenerator.instruction_modify_legacy(
                    tenant_id=tenant_id,
                    flow_id=args["flow_id"],
                    current=args["current"],
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    ideal_output=args["ideal_output"],
                )

            case "workflow_prompt_generate":
                return LLMGenerator.generate_rule_config(
                    tenant_id,
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    no_variable=True,
                )

            case "workflow_code_generate":
                return LLMGenerator.generate_code(
                    tenant_id=tenant_id,
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    code_language=args["language"],
                )

            case "workflow_prompt_edit":
                return LLMGenerator.instruction_modify_workflow(
                    tenant_id=tenant_id,
                    flow_id=args["flow_id"],
                    node_id=args["node_id"],
                    current=args["current"],
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    ideal_output=args["ideal_output"],
                    workflow_service=WorkflowService(),
                )

            case "workflow_code_edit":
                # Code edit uses the same workflow edit logic
                return LLMGenerator.instruction_modify_workflow(
                    tenant_id=tenant_id,
                    flow_id=args["flow_id"],
                    node_id=args["node_id"],
                    current=args["current"],
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    ideal_output=args["ideal_output"],
                    workflow_service=WorkflowService(),
                )

            case "memory_template_generate":
                return LLMGenerator.generate_memory_template(
                    tenant_id=tenant_id,
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                )

            case "memory_instruction_generate":
                return LLMGenerator.generate_memory_instruction(
                    tenant_id=tenant_id,
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                )

            case "memory_template_edit":
                return LLMGenerator.edit_memory_template(
                    tenant_id=tenant_id,
                    flow_id=args["flow_id"],
                    node_id=args.get("node_id") or None,
                    current=args["current"],
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    ideal_output=args["ideal_output"],
                )

            case "memory_instruction_edit":
                return LLMGenerator.edit_memory_instruction(
                    tenant_id=tenant_id,
                    flow_id=args["flow_id"],
                    node_id=args.get("node_id") or None,
                    current=args["current"],
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    ideal_output=args["ideal_output"],
                )

            case _:
                return {"error": f"Invalid request type: {request_type}"}, 400


@console_ns.route("/instruction-generate/template")
class InstructionGenerationTemplateApi(Resource):
    @api.doc("get_instruction_template")
    @api.doc(description="Get instruction generation template")
    @api.expect(
        api.model(
            "InstructionTemplateRequest",
            {
                "instruction": fields.String(required=True, description="Template instruction"),
                "ideal_output": fields.String(description="Expected ideal output"),
            },
        )
    )
    @api.response(200, "Template retrieved successfully")
    @api.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser().add_argument("type", type=str, required=True, default=False, location="json")
        args = parser.parse_args()
        match args["type"]:
            case "prompt":
                from core.llm_generator.prompts import INSTRUCTION_GENERATE_TEMPLATE_PROMPT

                return {"data": INSTRUCTION_GENERATE_TEMPLATE_PROMPT}
            case "code":
                from core.llm_generator.prompts import INSTRUCTION_GENERATE_TEMPLATE_CODE

                return {"data": INSTRUCTION_GENERATE_TEMPLATE_CODE}
            case _:
                raise ValueError(f"Invalid type: {args['type']}")
