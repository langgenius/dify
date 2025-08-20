from collections.abc import Sequence

from flask_login import current_user
from flask_restful import Resource, reqparse

from controllers.console import api
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
from libs.login import login_required


class RuleGenerateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("instruction", type=str, required=True, nullable=False, location="json")
        parser.add_argument("model_config", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("no_variable", type=bool, required=True, default=False, location="json")
        args = parser.parse_args()

        account = current_user
        try:
            rules = LLMGenerator.generate_rule_config(
                tenant_id=account.current_tenant_id,
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


class RuleCodeGenerateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("instruction", type=str, required=True, nullable=False, location="json")
        parser.add_argument("model_config", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("no_variable", type=bool, required=True, default=False, location="json")
        parser.add_argument("code_language", type=str, required=False, default="javascript", location="json")
        args = parser.parse_args()

        account = current_user
        try:
            code_result = LLMGenerator.generate_code(
                tenant_id=account.current_tenant_id,
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


class RuleStructuredOutputGenerateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("instruction", type=str, required=True, nullable=False, location="json")
        parser.add_argument("model_config", type=dict, required=True, nullable=False, location="json")
        args = parser.parse_args()

        account = current_user
        try:
            structured_output = LLMGenerator.generate_structured_output(
                tenant_id=account.current_tenant_id,
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


class InstructionGenerateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("flow_id", type=str, required=True, default="", location="json")
        parser.add_argument("node_id", type=str, required=False, default="", location="json")
        parser.add_argument("current", type=str, required=False, default="", location="json")
        parser.add_argument("language", type=str, required=False, default="javascript", location="json")
        parser.add_argument("instruction", type=str, required=True, nullable=False, location="json")
        parser.add_argument("model_config", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("ideal_output", type=str, required=False, default="", location="json")
        args = parser.parse_args()
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
                from models import App, db
                from services.workflow_service import WorkflowService

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
                            current_user.current_tenant_id,
                            instruction=args["instruction"],
                            model_config=args["model_config"],
                            no_variable=True,
                        )
                    case "agent":
                        return LLMGenerator.generate_rule_config(
                            current_user.current_tenant_id,
                            instruction=args["instruction"],
                            model_config=args["model_config"],
                            no_variable=True,
                        )
                    case "code":
                        return LLMGenerator.generate_code(
                            tenant_id=current_user.current_tenant_id,
                            instruction=args["instruction"],
                            model_config=args["model_config"],
                            code_language=args["language"],
                        )
                    case _:
                        return {"error": f"invalid node type: {node_type}"}
            if args["node_id"] == "" and args["current"] != "":  # For legacy app without a workflow
                return LLMGenerator.instruction_modify_legacy(
                    tenant_id=current_user.current_tenant_id,
                    flow_id=args["flow_id"],
                    current=args["current"],
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    ideal_output=args["ideal_output"],
                )
            if args["node_id"] != "" and args["current"] != "":  # For workflow node
                return LLMGenerator.instruction_modify_workflow(
                    tenant_id=current_user.current_tenant_id,
                    flow_id=args["flow_id"],
                    node_id=args["node_id"],
                    current=args["current"],
                    instruction=args["instruction"],
                    model_config=args["model_config"],
                    ideal_output=args["ideal_output"],
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


class InstructionGenerationTemplateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self) -> dict:
        parser = reqparse.RequestParser()
        parser.add_argument("type", type=str, required=True, default=False, location="json")
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


api.add_resource(RuleGenerateApi, "/rule-generate")
api.add_resource(RuleCodeGenerateApi, "/rule-code-generate")
api.add_resource(RuleStructuredOutputGenerateApi, "/rule-structured-output-generate")
api.add_resource(InstructionGenerateApi, "/instruction-generate")
api.add_resource(InstructionGenerationTemplateApi, "/instruction-generate/template")
