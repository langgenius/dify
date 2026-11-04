from datetime import datetime
from decimal import Decimal
from http import HTTPStatus
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.errors import InvalidArgumentError
from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, model_validate
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.datetime_utils import parse_time_range
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.login import current_account_with_tenant
from machinery.context import RequestContext
from models.model import AppMode
from services.app.console_service import ConsoleAppNotFoundError


class StatisticTimeRangeQuery(BaseModel):
    start: str | None = Field(default=None, description="Start date (YYYY-MM-DD HH:MM)")
    end: str | None = Field(default=None, description="End date (YYYY-MM-DD HH:MM)")

    @field_validator("start", "end", mode="before")
    @classmethod
    def empty_string_to_none(cls, value: str | None) -> str | None:
        if value == "":
            return None
        return value


class DailyMessageStatisticItem(ResponseModel):
    date: str
    message_count: int


register_schema_models(console_ns, StatisticTimeRangeQuery)


class StatisticDataResponse[T](ResponseModel):
    data: list[T]


class DailyMessageStatisticResponse(StatisticDataResponse[DailyMessageStatisticItem]):
    pass


class DailyConversationStatisticItem(ResponseModel):
    date: str
    conversation_count: int


class DailyConversationStatisticResponse(StatisticDataResponse[DailyConversationStatisticItem]):
    pass


class DailyTerminalStatisticItem(ResponseModel):
    date: str
    terminal_count: int


class DailyTerminalStatisticResponse(StatisticDataResponse[DailyTerminalStatisticItem]):
    pass


class DailyTokenCostStatisticItem(ResponseModel):
    date: str
    token_count: int | None = None
    total_price: Decimal | None = None
    currency: str | None = None


class DailyTokenCostStatisticResponse(StatisticDataResponse[DailyTokenCostStatisticItem]):
    pass


class AverageSessionInteractionStatisticItem(ResponseModel):
    date: str
    interactions: float


class AverageSessionInteractionStatisticResponse(StatisticDataResponse[AverageSessionInteractionStatisticItem]):
    pass


class UserSatisfactionRateStatisticItem(ResponseModel):
    date: str
    rate: float


class UserSatisfactionRateStatisticResponse(StatisticDataResponse[UserSatisfactionRateStatisticItem]):
    pass


class AverageResponseTimeStatisticItem(ResponseModel):
    date: str
    latency: float


class AverageResponseTimeStatisticResponse(StatisticDataResponse[AverageResponseTimeStatisticItem]):
    pass


class TokensPerSecondStatisticItem(ResponseModel):
    date: str
    tps: float


class TokensPerSecondStatisticResponse(StatisticDataResponse[TokensPerSecondStatisticItem]):
    pass


register_response_schema_models(
    console_ns,
    DailyMessageStatisticItem,
    DailyMessageStatisticResponse,
    DailyConversationStatisticItem,
    DailyConversationStatisticResponse,
    DailyTerminalStatisticItem,
    DailyTerminalStatisticResponse,
    DailyTokenCostStatisticItem,
    DailyTokenCostStatisticResponse,
    AverageSessionInteractionStatisticItem,
    AverageSessionInteractionStatisticResponse,
    UserSatisfactionRateStatisticItem,
    UserSatisfactionRateStatisticResponse,
    AverageResponseTimeStatisticItem,
    AverageResponseTimeStatisticResponse,
    TokensPerSecondStatisticItem,
    TokensPerSecondStatisticResponse,
)


def _resolve_statistic_time_range(
    req_data: StatisticTimeRangeQuery,
) -> tuple[datetime | None, datetime | None, str]:
    timezone = current_account_with_tenant().account.timezone
    assert timezone is not None

    try:
        start_date, end_date = parse_time_range(req_data.start, req_data.end, timezone)
    except ValueError as error:
        raise InvalidArgumentError(str(error)) from error

    return start_date, end_date, timezone


@console_ns.route("/apps/<uuid:app_id>/statistics/daily-messages")
class DailyMessageStatistic(Resource):
    @console_ns.doc("get_daily_message_statistics")
    @console_ns.doc(description="Get daily message statistics for an application")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(StatisticTimeRangeQuery)})
    @console_ns.response(
        HTTPStatus.OK,
        "Daily message statistics retrieved successfully",
        console_ns.models[DailyMessageStatisticResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @model_validate(StatisticTimeRangeQuery)
    def get(
        self, req_data: StatisticTimeRangeQuery, request_context: RequestContext, app_id: UUID
    ) -> dict[str, object]:
        try:
            app = application_services().apps.console.get_reference(request_context, str(app_id))
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError() from error
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().app_statistics.get_daily_messages(
            app_id=app.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(DailyMessageStatisticResponse, {"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/statistics/daily-conversations")
class DailyConversationStatistic(Resource):
    @console_ns.doc("get_daily_conversation_statistics")
    @console_ns.doc(description="Get daily conversation statistics for an application")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(StatisticTimeRangeQuery)})
    @console_ns.response(
        HTTPStatus.OK,
        "Daily conversation statistics retrieved successfully",
        console_ns.models[DailyConversationStatisticResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @model_validate(StatisticTimeRangeQuery)
    def get(
        self, req_data: StatisticTimeRangeQuery, request_context: RequestContext, app_id: UUID
    ) -> dict[str, object]:
        try:
            app = application_services().apps.console.get_reference(request_context, str(app_id))
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError() from error
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().app_statistics.get_daily_conversations(
            app_id=app.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(DailyConversationStatisticResponse, {"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/statistics/daily-end-users")
class DailyTerminalsStatistic(Resource):
    @console_ns.doc("get_daily_terminals_statistics")
    @console_ns.doc(description="Get daily terminal/end-user statistics for an application")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(StatisticTimeRangeQuery)})
    @console_ns.response(
        HTTPStatus.OK,
        "Daily terminal statistics retrieved successfully",
        console_ns.models[DailyTerminalStatisticResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @model_validate(StatisticTimeRangeQuery)
    def get(
        self, req_data: StatisticTimeRangeQuery, request_context: RequestContext, app_id: UUID
    ) -> dict[str, object]:
        try:
            app = application_services().apps.console.get_reference(request_context, str(app_id))
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError() from error
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().app_statistics.get_daily_terminals(
            app_id=app.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(DailyTerminalStatisticResponse, {"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/statistics/token-costs")
class DailyTokenCostStatistic(Resource):
    @console_ns.doc("get_daily_token_cost_statistics")
    @console_ns.doc(description="Get daily token cost statistics for an application")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(StatisticTimeRangeQuery)})
    @console_ns.response(
        HTTPStatus.OK,
        "Daily token cost statistics retrieved successfully",
        console_ns.models[DailyTokenCostStatisticResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @model_validate(StatisticTimeRangeQuery)
    def get(
        self, req_data: StatisticTimeRangeQuery, request_context: RequestContext, app_id: UUID
    ) -> dict[str, object]:
        try:
            app = application_services().apps.console.get_reference(request_context, str(app_id))
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError() from error
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().app_statistics.get_daily_token_costs(
            app_id=app.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(DailyTokenCostStatisticResponse, {"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/statistics/average-session-interactions")
class AverageSessionInteractionStatistic(Resource):
    @console_ns.doc("get_average_session_interaction_statistics")
    @console_ns.doc(description="Get average session interaction statistics for an application")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(StatisticTimeRangeQuery)})
    @console_ns.response(
        HTTPStatus.OK,
        "Average session interaction statistics retrieved successfully",
        console_ns.models[AverageSessionInteractionStatisticResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @model_validate(StatisticTimeRangeQuery)
    def get(
        self, req_data: StatisticTimeRangeQuery, request_context: RequestContext, app_id: UUID
    ) -> dict[str, object]:
        try:
            app = application_services().apps.console.get_reference(request_context, str(app_id))
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError() from error
        supported_modes = (AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT)
        if app.mode not in supported_modes:
            mode_values = {mode.value for mode in supported_modes}
            raise AppNotFoundError(f"App mode is not in the supported list: {mode_values}")
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().app_statistics.get_average_session_interactions(
            app_id=app.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(AverageSessionInteractionStatisticResponse, {"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/statistics/user-satisfaction-rate")
class UserSatisfactionRateStatistic(Resource):
    @console_ns.doc("get_user_satisfaction_rate_statistics")
    @console_ns.doc(description="Get user satisfaction rate statistics for an application")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(StatisticTimeRangeQuery)})
    @console_ns.response(
        HTTPStatus.OK,
        "User satisfaction rate statistics retrieved successfully",
        console_ns.models[UserSatisfactionRateStatisticResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @model_validate(StatisticTimeRangeQuery)
    def get(
        self, req_data: StatisticTimeRangeQuery, request_context: RequestContext, app_id: UUID
    ) -> dict[str, object]:
        try:
            app = application_services().apps.console.get_reference(request_context, str(app_id))
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError() from error
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().app_statistics.get_user_satisfaction_rates(
            app_id=app.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(UserSatisfactionRateStatisticResponse, {"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/statistics/average-response-time")
class AverageResponseTimeStatistic(Resource):
    @console_ns.doc("get_average_response_time_statistics")
    @console_ns.doc(description="Get average response time statistics for an application")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(StatisticTimeRangeQuery)})
    @console_ns.response(
        HTTPStatus.OK,
        "Average response time statistics retrieved successfully",
        console_ns.models[AverageResponseTimeStatisticResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @model_validate(StatisticTimeRangeQuery)
    def get(
        self, req_data: StatisticTimeRangeQuery, request_context: RequestContext, app_id: UUID
    ) -> dict[str, object]:
        try:
            app = application_services().apps.console.get_reference(request_context, str(app_id))
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError() from error
        supported_modes = (AppMode.COMPLETION,)
        if app.mode not in supported_modes:
            mode_values = {mode.value for mode in supported_modes}
            raise AppNotFoundError(f"App mode is not in the supported list: {mode_values}")
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().app_statistics.get_average_response_times(
            app_id=app.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(AverageResponseTimeStatisticResponse, {"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/statistics/tokens-per-second")
class TokensPerSecondStatistic(Resource):
    @console_ns.doc("get_tokens_per_second_statistics")
    @console_ns.doc(description="Get tokens per second statistics for an application")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(StatisticTimeRangeQuery)})
    @console_ns.response(
        HTTPStatus.OK,
        "Tokens per second statistics retrieved successfully",
        console_ns.models[TokensPerSecondStatisticResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @model_validate(StatisticTimeRangeQuery)
    def get(
        self, req_data: StatisticTimeRangeQuery, request_context: RequestContext, app_id: UUID
    ) -> dict[str, object]:
        try:
            app = application_services().apps.console.get_reference(request_context, str(app_id))
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError() from error
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().app_statistics.get_tokens_per_second(
            app_id=app.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(TokensPerSecondStatisticResponse, {"data": response_data})
