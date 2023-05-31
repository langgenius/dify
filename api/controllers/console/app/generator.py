from flask_login import login_required, current_user
from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.app.error import ProviderNotInitializeError, ProviderQuotaExceededError, \
    CompletionRequestError, ProviderModelCurrentlyNotSupportError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.generator.llm_generator import LLMGenerator
from core.llm.error import ProviderTokenNotInitError, QuotaExceededError, LLMBadRequestError, LLMAPIConnectionError, \
    LLMAPIUnavailableError, LLMRateLimitError, LLMAuthorizationError, ModelCurrentlyNotSupportError


class IntroductionGenerateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('prompt_template', type=str, required=True, location='json')
        args = parser.parse_args()

        account = current_user

        try:
            answer = LLMGenerator.generate_introduction(
                account.current_tenant_id,
                args['prompt_template']
            )
        except ProviderTokenNotInitError:
            raise ProviderNotInitializeError()
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except (LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError,
                LLMRateLimitError, LLMAuthorizationError) as e:
            raise CompletionRequestError(str(e))

        return {'introduction': answer}


class RuleGenerateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('audiences', type=str, required=True, nullable=False, location='json')
        parser.add_argument('hoping_to_solve', type=str, required=True, nullable=False, location='json')
        args = parser.parse_args()

        account = current_user

        try:
            rules = LLMGenerator.generate_rule_config(
                account.current_tenant_id,
                args['audiences'],
                args['hoping_to_solve']
            )
        except ProviderTokenNotInitError:
            raise ProviderNotInitializeError()
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except (LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError,
                LLMRateLimitError, LLMAuthorizationError) as e:
            raise CompletionRequestError(str(e))

        return rules


api.add_resource(IntroductionGenerateApi, '/introduction-generate')
api.add_resource(RuleGenerateApi, '/rule-generate')
