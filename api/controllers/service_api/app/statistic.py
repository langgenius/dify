from decimal import Decimal
from zoneinfo import ZoneInfoNotFoundError

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.errors import InvalidArgumentError
from controllers.common.schema import (
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

# 公共查询参数


class StatisticQuery(BaseModel):
    start: str | None = Field(default=None)
    end: str | None = Field(default=None)
    timezone: str = Field(default="UTC")

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


# 统计响应模型


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


# 公共统计查询


def query_statistics(app_model, query, method_name):
    start_date, end_date = resolve_time_range(query)

    service = application_services().app_statistics
    method = getattr(service, method_name)

    return method(
        app_id=app_model.id,
        start_date=start_date,
        end_date=end_date,
        timezone=query.timezone,
    )


def check_mode(app_model, supported_modes):
    if app_model.mode not in supported_modes:
        raise InvalidArgumentError("This statistic is not supported for the current application mode.")


# 每日消息量


@service_api_ns.route("/statistics/daily-messages")
class DailyMessageApi(Resource):
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):

        data = query_statistics(app_model, req_data, "get_daily_messages")
        return dump_response(DailyMessageResponse, {"data": data})


# 每日会话量


@service_api_ns.route("/statistics/daily-conversations")
class DailyConversationApi(Resource):
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):

        data = query_statistics(app_model, req_data, "get_daily_conversations")
        return dump_response(DailyConversationResponse, {"data": data})


# 每日终端用户量


@service_api_ns.route("/statistics/daily-end-users")
class DailyEndUsersApi(Resource):
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):

        data = query_statistics(app_model, req_data, "get_daily_terminals")
        return dump_response(DailyEndUserResponse, {"data": data})


# Token消耗及费用


@service_api_ns.route("/statistics/token-costs")
class TokenCostsApi(Resource):
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):

        data = query_statistics(app_model, req_data, "get_daily_token_costs")
        return dump_response(TokenCostResponse, {"data": data})


# 平均会话交互次数


@service_api_ns.route("/statistics/average-session-interactions")
class AverageSessionInteractionsApi(Resource):
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


# 用户满意度


@service_api_ns.route("/statistics/user-satisfaction-rate")
class UserSatisfactionApi(Resource):
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):

        data = query_statistics(
            app_model,
            req_data,
            "get_user_satisfaction_rates",
        )
        return dump_response(UserSatisfactionResponse, {"data": data})


# 平均响应时间


@service_api_ns.route("/statistics/average-response-time")
class AverageResponseTimeApi(Resource):
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


# 每秒生成Token数


@service_api_ns.route("/statistics/tokens-per-second")
class TokensPerSecondApi(Resource):
    @validate_app_token
    @model_validate(StatisticQuery)
    def get(self, req_data: StatisticQuery, app_model: App):

        data = query_statistics(
            app_model,
            req_data,
            "get_tokens_per_second",
        )
        return dump_response(TokensPerSecondResponse, {"data": data})
