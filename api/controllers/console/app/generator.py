from collections.abc import Sequence

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
from core.helper.code_executor.javascript.javascript_code_provider import JavascriptCodeProvider
from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider
from core.llm_generator.llm_generator import LLMGenerator
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models import App
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
                "flow_id": fields.String(required=True, description="Workflow/Flow ID"),
                "node_id": fields.String(description="Node ID for workflow context"),
                "current": fields.String(description="Current instruction text"),
                "language": fields.String(default="javascript", description="Programming language (javascript/python)"),
                "instruction": fields.String(required=True, description="Instruction for generation"),
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
            .add_argument("flow_id", type=str, required=True, default="", location="json")
            .add_argument("node_id", type=str, required=False, default="", location="json")
            .add_argument("current", type=str, required=False, default="", location="json")
            .add_argument("language", type=str, required=False, default="javascript", location="json")
            .add_argument("instruction", type=str, required=True, nullable=False, location="json")
            .add_argument("model_config", type=dict, required=True, nullable=False, location="json")
            .add_argument("ideal_output", type=str, required=False, default="", location="json")
        )
        args = parser.parse_args()
        _, current_tenant_id = current_account_with_tenant()
        code_template = (
            Python3CodeProvider.get_default_code()
            if args["language"] == "python"
            else (JavascriptCodeProvider.get_default_code())
            if args["language"] == "javascript"
            else ""
        )
        try:
            # Generate from nothing for a workflow node
            if (args["current"] == code_template or args["current"] == "") and args["node_id"] != "":
                app = db.session.query(App).where(App.id == args["flow_id"]).first()
                if not app:
                    return {"error": f"app {args['flow_id']} not found"}, 400
                workflow = WorkflowService().get_draft_workflow(app_model=app)
                if not workflow:
                    return {"error": f"workflow {args['flow_id']} not found"}, 400
                nodes: Sequence = workflow.graph_dict["nodes"]
                node = [node for node in nodes if node["id"] == args["node_id"]]
                if len(node) == 0:
                    return {"error": f"node {args['node_id']} not found"}, 400
                node_type = node[0]["data"]["type"]
                match node_type:
                    case "llm":
                        return LLMGenerator.generate_rule_config(
                            current_tenant_id,
                            instruction=args["instruction"],
                            model_config=args["model_config"],
                            no_variable=True,
                        )
                    case "agent":
                        return LLMGenerator.generate_rule_config(
                            current_tenant_id,
                            instruction=args["instruction"],
                            model_config=args["model_config"],
                            no_variable=True,
                        )
                    case "code":
                        return LLMGenerator.generate_code(
                            tenant_id=current_tenant_id,
                            instruction=args["instruction"],
                            model_config=args["model_config"],
                            code_language=args["language"],
                        )
                    case _:
                        return {"error": f"invalid node type: {node_type}"}
            if args["node_id"] == "" and args["current"] != "":  # For legacy app without a workflow
                return LLMGenerator.instruction_modify_legacy(
                    tenant_id=current_tenant_id,
                    flow_id=args["flow_id"],
                    current=args["current"],
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    ideal_output=args["ideal_output"],
                )
            if args["node_id"] != "" and args["current"] != "":  # For workflow node
                return LLMGenerator.instruction_modify_workflow(
                    tenant_id=current_tenant_id,
                    flow_id=args["flow_id"],
                    node_id=args["node_id"],
                    current=args["current"],
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    ideal_output=args["ideal_output"],
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
