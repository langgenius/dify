import logging

from flask import Request, Response

from core.plugin.entities.plugin import TriggerProviderID
from core.trigger.trigger_manager import TriggerManager
from services.trigger.trigger_provider_service import TriggerProviderService

logger = logging.getLogger(__name__)


class TriggerSubscriptionValidationService:
    __VALIDATION_REQUEST_CACHE_COUNT__ = 10
    __VALIDATION_REQUEST_CACHE_EXPIRE_MS__ = 5 * 60 * 1000

    @classmethod
    def append_validation_request_log(cls, endpoint_id: str, request: Request, response: Response) -> None:
        """
        Append the validation request log to Redis.
        """
        

    @classmethod
    def process_validating_endpoint(cls, endpoint_id: str, request: Request) -> Response | None:
        """
        Process a temporary endpoint request.

        :param endpoint_id: The endpoint identifier
        :param request: The Flask request object
        :return: The Flask response object
        """
        # check if validation endpoint exists
        subscription_validation = TriggerProviderService.get_subscription_validation(endpoint_id)
        if not subscription_validation:
            return None

        # response to validation endpoint
        controller = TriggerManager.get_trigger_provider(
            subscription_validation.tenant_id, TriggerProviderID(subscription_validation.provider_id)
        )
        response = controller.dispatch(
            user_id=subscription_validation.user_id,
            request=request,
            subscription=subscription_validation.to_subscription(),
        )
        # append the request log
        cls.append_validation_request_log(endpoint_id, request, response.response)
        return response.response
