import os
from typing import cast

from flask_login import current_user  # type: ignore
from flask_restful import Resource, reqparse  # type: ignore

from controllers.console import api
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.wraps import account_initialization_required, setup_required
from core.auto.workflow_generator.workflow_generator import WorkflowGenerator
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.llm_generator.llm_generator import LLMGenerator
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
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
        PROMPT_GENERATION_MAX_TOKENS = int(os.getenv("PROMPT_GENERATION_MAX_TOKENS", "512"))

        try:
            rules = LLMGenerator.generate_rule_config(
                tenant_id=account.current_tenant_id,
                instruction=args["instruction"],
                model_config=args["model_config"],
                no_variable=args["no_variable"],
                rule_config_max_tokens=PROMPT_GENERATION_MAX_TOKENS,
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
        CODE_GENERATION_MAX_TOKENS = int(os.getenv("CODE_GENERATION_MAX_TOKENS", "1024"))
        try:
            code_result = LLMGenerator.generate_code(
                tenant_id=account.current_tenant_id,
                instruction=args["instruction"],
                model_config=args["model_config"],
                code_language=args["code_language"],
                max_tokens=CODE_GENERATION_MAX_TOKENS,
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


class AutoGenerateWorkflowApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        """
        Auto generate workflow
        """

        parser = reqparse.RequestParser()
        parser.add_argument("instruction", type=str, required=True, location="json")
        parser.add_argument("model_config", type=dict, required=True, location="json")
        tenant_id = cast(str, current_user.current_tenant_id)
        args = parser.parse_args()
        instruction = args.get("instruction")
        if not instruction:
            raise ValueError("Instruction is required")
        if not args.get("model_config"):
            raise ValueError("Model config is required")
        model_config = cast(dict, args.get("model_config"))
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )
        workflow_generator = WorkflowGenerator(
            model_instance=model_instance,
        )
        workflow_yaml = workflow_generator.generate_workflow(
            user_requirement=instruction,
        )
        return workflow_yaml


api.add_resource(RuleGenerateApi, "/rule-generate")
api.add_resource(RuleCodeGenerateApi, "/rule-code-generate")
api.add_resource(
    AutoGenerateWorkflowApi,
    "/auto-generate",
)
