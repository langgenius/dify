from decimal import Decimal
from zoneinfo import ZoneInfoNotFoundError

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.errors import InvalidArgumentError
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import validate_app_token
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.datetime_utils import parse_time_range
from libs.helper import dump_response
from models.model import App, AppMode

# Request parameters


class StatisticQuery(BaseModel):
    start: str | None = Field(
        default=None,
        description=(
            "Start of the statistics period in YYYY-MM-DD HH:MM format. "
            "If omitted, no explicit time bound is passed to the statistics service."
        ),
    )
    end: str | None = Field(
        default=None,
        description=(
            "End of the statistics period in YYYY-MM-DD HH:MM format. "
            "If omitted, no explicit time bound is passed to the statistics service."
        ),
    )
    timezone: str = Field(
        default="UTC",
        description="IANA timezone name used for the statistics period. Defaults to UTC.",
    )

    @field_validator("start", "end", mode="before")
    @classmethod
    def empty_to_none(cls, value):
        return None if value == "" else value


def resolve_time_range(query: StatisticQuery):
    try:
        return parse_time_range(
            query.start,
            query.end,
            query.timezone,
        )
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise InvalidArgumentError(str(exc)) from exc


# Response models


class StatisticResponse[T](ResponseModel):
    data: list[T]


class DailyMessageItem(ResponseModel):
    date: str
    message_count: int


class DailyConversationItem(ResponseModel):
    date: str
    conversation_count: int


class DailyEndUserItem(ResponseModel):
    date: str
    terminal_count: int


class TokenCostItem(ResponseModel):
    date: str
    token_count: int | None = None
    total_price: Decimal | None = None
    currency: str | None = None


class SessionInteractionItem(ResponseModel):
    date: str
    interactions: float


class UserSatisfactionItem(ResponseModel):
    date: str
    rate: float


class ResponseTimeItem(ResponseModel):
    date: str
    latency: float


class TokensPerSecondItem(ResponseModel):
    date: str
    tps: float


class DailyMessageResponse(StatisticResponse[DailyMessageItem]):
    pass


class DailyConversationResponse(StatisticResponse[DailyConversationItem]):
    pass


class DailyEndUserResponse(StatisticResponse[DailyEndUserItem]):
    pass


class TokenCostResponse(StatisticResponse[TokenCostItem]):
    pass


class SessionInteractionResponse(StatisticResponse[SessionInteractionItem]):
    pass


class UserSatisfactionResponse(StatisticResponse[UserSatisfactionItem]):
    pass


class ResponseTimeResponse(StatisticResponse[ResponseTimeItem]):
    pass


class TokensPerSecondResponse(StatisticResponse[TokensPerSecondItem]):
    pass


register_schema_models(service_api_ns, StatisticQuery)

register_response_schema_models(
    service_api_ns,
    DailyMessageItem,
    DailyConversationItem,
    DailyEndUserItem,
    TokenCostItem,
    SessionInteractionItem,
    UserSatisfactionItem,
    ResponseTimeItem,
    TokensPerSecondItem,
    DailyMessageResponse,
    DailyConversationResponse,
    DailyEndUserResponse,
    TokenCostResponse,
    SessionInteractionResponse,
    UserSatisfactionResponse,
    ResponseTimeResponse,
    TokensPerSecondResponse,
)


# Shared statistics helpers


def query_statistics(app_model, query, method_name):
    start_date, end_date = resolve_time_range(query)

    service = application_services().app_statistics

    methods = {
        "get_daily_messages": service.get_daily_messages,
        "get_daily_conversations": service.get_daily_conversations,
        "get_daily_terminals": service.get_daily_terminals,
        "get_daily_token_costs": service.get_daily_token_costs,
        "get_average_session_interactions": service.get_average_session_interactions,
        "get_user_satisfaction_rates": service.get_user_satisfaction_rates,
        "get_average_response_times": service.get_average_response_times,
        "get_tokens_per_second": service.get_tokens_per_second,
    }

    method = methods[method_name]

    return method(
        app_id=app_model.id,
        start_date=start_date,
        end_date=end_date,
        timezone=query.timezone,
    )


def check_mode(app_model, supported_modes):
    if app_model.mode not in supported_modes:
        raise InvalidArgumentError("This statistic is not supported for the current application mode.")


# Daily messages


@service_api_ns.route("/statistics/daily-messages")
class DailyMessageApi(Resource):
    @service_api_ns.doc(
        "get_daily_message_statistics",
        summary="Get Daily Message Statistics",
        description=("Retrieve daily message counts for the authenticated application."),
        tags=["Statistics"],
        params=query_params_from_model(StatisticQuery),
        responses={
            400: "Invalid time range or timezone.",
            401: "Unauthorized - invalid API token.",
        },
    )
    @service_api_ns.response(
        200,
        "Daily message statistics retrieved successfully.",
        service_api_ns.models[DailyMessageResponse.__name__],
    )
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):
        data = query_statistics(
            app_model,
            req_data,
            "get_daily_messages",
        )
        return dump_response(DailyMessageResponse, {"data": data})


# Daily conversations


@service_api_ns.route("/statistics/daily-conversations")
class DailyConversationApi(Resource):
    @service_api_ns.doc(
        "get_daily_conversation_statistics",
        summary="Get Daily Conversation Statistics",
        description=("Retrieve daily conversation counts for the authenticated application."),
        tags=["Statistics"],
        params=query_params_from_model(StatisticQuery),
        responses={
            400: "Invalid time range or timezone.",
            401: "Unauthorized - invalid API token.",
        },
    )
    @service_api_ns.response(
        200,
        "Daily conversation statistics retrieved successfully.",
        service_api_ns.models[DailyConversationResponse.__name__],
    )
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):
        data = query_statistics(
            app_model,
            req_data,
            "get_daily_conversations",
        )
        return dump_response(DailyConversationResponse, {"data": data})


# Daily end users


@service_api_ns.route("/statistics/daily-end-users")
class DailyEndUsersApi(Resource):
    @service_api_ns.doc(
        "get_daily_end_user_statistics",
        summary="Get Daily End User Statistics",
        description=("Retrieve daily end-user counts for the authenticated application."),
        tags=["Statistics"],
        params=query_params_from_model(StatisticQuery),
        responses={
            400: "Invalid time range or timezone.",
            401: "Unauthorized - invalid API token.",
        },
    )
    @service_api_ns.response(
        200,
        "Daily end-user statistics retrieved successfully.",
        service_api_ns.models[DailyEndUserResponse.__name__],
    )
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):
        data = query_statistics(
            app_model,
            req_data,
            "get_daily_terminals",
        )
        return dump_response(DailyEndUserResponse, {"data": data})


# Token usage and costs


@service_api_ns.route("/statistics/token-costs")
class TokenCostsApi(Resource):
    @service_api_ns.doc(
        "get_token_cost_statistics",
        summary="Get Token Usage and Cost Statistics",
        description=("Retrieve daily token consumption and cost statistics for the authenticated application."),
        tags=["Statistics"],
        params=query_params_from_model(StatisticQuery),
        responses={
            400: "Invalid time range or timezone.",
            401: "Unauthorized - invalid API token.",
        },
    )
    @service_api_ns.response(
        200,
        "Token usage and cost statistics retrieved successfully.",
        service_api_ns.models[TokenCostResponse.__name__],
    )
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):
        data = query_statistics(
            app_model,
            req_data,
            "get_daily_token_costs",
        )
        return dump_response(TokenCostResponse, {"data": data})


# Average session interactions


@service_api_ns.route("/statistics/average-session-interactions")
class AverageSessionInteractionsApi(Resource):
    @service_api_ns.doc(
        "get_average_session_interaction_statistics",
        summary="Get Average Session Interactions",
        description=(
            "Retrieve average interactions per session for the authenticated "
            "application. Supported application modes include chat, "
            "agent chat, advanced chat, and agent."
        ),
        tags=["Statistics"],
        params=query_params_from_model(StatisticQuery),
        responses={
            400: "Invalid time range, timezone, or unsupported application mode.",
            401: "Unauthorized - invalid API token.",
        },
    )
    @service_api_ns.response(
        200,
        "Average session interaction statistics retrieved successfully.",
        service_api_ns.models[SessionInteractionResponse.__name__],
    )
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):
        check_mode(
            app_model,
            (
                AppMode.CHAT,
                AppMode.AGENT_CHAT,
                AppMode.ADVANCED_CHAT,
                AppMode.AGENT,
            ),
        )

        data = query_statistics(
            app_model,
            req_data,
            "get_average_session_interactions",
        )
        return dump_response(SessionInteractionResponse, {"data": data})


# User satisfaction


@service_api_ns.route("/statistics/user-satisfaction-rate")
class UserSatisfactionApi(Resource):
    @service_api_ns.doc(
        "get_user_satisfaction_statistics",
        summary="Get User Satisfaction Statistics",
        description=("Retrieve user satisfaction rates for the authenticated application."),
        tags=["Statistics"],
        params=query_params_from_model(StatisticQuery),
        responses={
            400: "Invalid time range or timezone.",
            401: "Unauthorized - invalid API token.",
        },
    )
    @service_api_ns.response(
        200,
        "User satisfaction statistics retrieved successfully.",
        service_api_ns.models[UserSatisfactionResponse.__name__],
    )
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):
        data = query_statistics(
            app_model,
            req_data,
            "get_user_satisfaction_rates",
        )
        return dump_response(UserSatisfactionResponse, {"data": data})


# Average response time


@service_api_ns.route("/statistics/average-response-time")
class AverageResponseTimeApi(Resource):
    @service_api_ns.doc(
        "get_average_response_time_statistics",
        summary="Get Average Response Time Statistics",
        description=(
            "Retrieve average response times for the authenticated application. "
            "This statistic is supported for completion applications."
        ),
        tags=["Statistics"],
        params=query_params_from_model(StatisticQuery),
        responses={
            400: "Invalid time range, timezone, or unsupported application mode.",
            401: "Unauthorized - invalid API token.",
        },
    )
    @service_api_ns.response(
        200,
        "Average response time statistics retrieved successfully.",
        service_api_ns.models[ResponseTimeResponse.__name__],
    )
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):
        check_mode(app_model, (AppMode.COMPLETION,))

        data = query_statistics(
            app_model,
            req_data,
            "get_average_response_times",
        )
        return dump_response(ResponseTimeResponse, {"data": data})


# Tokens per second


@service_api_ns.route("/statistics/tokens-per-second")
class TokensPerSecondApi(Resource):
    @service_api_ns.doc(
        "get_tokens_per_second_statistics",
        summary="Get Tokens Per Second Statistics",
        description=("Retrieve token generation throughput statistics for the authenticated application."),
        tags=["Statistics"],
        params=query_params_from_model(StatisticQuery),
        responses={
            400: "Invalid time range or timezone.",
            401: "Unauthorized - invalid API token.",
        },
    )
    @service_api_ns.response(
        200,
        "Tokens per second statistics retrieved successfully.",
        service_api_ns.models[TokensPerSecondResponse.__name__],
    )
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):
        data = query_statistics(
            app_model,
            req_data,
            "get_tokens_per_second",
        )
        return dump_response(TokensPerSecondResponse, {"data": data})
