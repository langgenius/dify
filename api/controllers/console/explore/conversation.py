"""HTTP admission and response contracts for installed-app conversations."""

from collections.abc import Callable
from functools import wraps
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.controller_schemas import ConversationRenamePayload
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.explore.error import (
    ConversationCursorNotFoundHTTPError,
    ConversationFirstMessageNotFoundHTTPError,
    ConversationNameRequiredHTTPError,
    ConversationNotFoundHTTPError,
    InstalledAppNotFoundHTTPError,
    NotChatAppError,
)
from controllers.console.explore.installed_app_admission import get_installed_app
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from extensions.ext_application_services import application_services
from fields.conversation_fields import ConversationInfiniteScrollPagination, ResultResponse, SimpleConversation
from libs.helper import UUIDStrOrEmpty, dump_response
from machinery.context import RequestContext
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.errors.message import MessageNotExistsError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_conversation_service import ConversationNameRequiredError, ConversationNotChatAppError


class ConversationListQuery(BaseModel):
    last_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)
    pinned: bool | None = None

    @field_validator("limit", mode="before")
    @classmethod
    def parse_limit(cls, value: object) -> object:
        # Preserve request.args.get(..., default=20, type=int) coercion.
        if isinstance(value, str):
            try:
                return int(value)
            except ValueError:
                return 20
        return value

    @field_validator("pinned", mode="before")
    @classmethod
    def parse_pinned(cls, value: object) -> object:
        # Existing callers use the literal query string "true" for pinned items.
        return value == "true" if isinstance(value, str) else value


register_schema_models(console_ns, ConversationListQuery, ConversationRenamePayload)
register_response_schema_models(console_ns, ConversationInfiniteScrollPagination, ResultResponse, SimpleConversation)


def _conversation_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Translate the shared conversation use-case errors at the Console boundary."""

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except InstalledAppNotFoundError as error:
            raise InstalledAppNotFoundHTTPError() from error
        except ConversationNotChatAppError as error:
            raise NotChatAppError() from error
        except ConversationNotExistsError as error:
            raise ConversationNotFoundHTTPError() from error
        except LastConversationNotExistsError as error:
            raise ConversationCursorNotFoundHTTPError() from error
        except MessageNotExistsError as error:
            raise ConversationFirstMessageNotFoundHTTPError() from error
        except ConversationNameRequiredError as error:
            raise ConversationNameRequiredHTTPError() from error

    return decorated


@console_ns.route("/installed-apps/<uuid:installed_app_id>/conversations", endpoint="installed_app_conversations")
class ConversationListApi(Resource):
    @console_ns.doc(params=query_params_from_model(ConversationListQuery))
    @console_ns.response(200, "Success", console_ns.models[ConversationInfiniteScrollPagination.__name__])
    @console_account_admission()
    @get_installed_app
    @model_validate(ConversationListQuery)
    @_conversation_errors
    def get(
        self, query: ConversationListQuery, request_context: RequestContext, installed_app: InstalledAppRef
    ) -> dict[str, object]:
        page = application_services().installed_app_conversations.get_page(
            installed_app=installed_app,
            account_id=request_context.account_id,
            last_id=query.last_id or None,
            limit=query.limit,
            pinned=query.pinned,
        )
        return dump_response(ConversationInfiniteScrollPagination, page)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>", endpoint="installed_app_conversation"
)
class ConversationApi(Resource):
    @console_ns.response(204, "Conversation deleted successfully")
    @console_account_admission()
    @get_installed_app
    @_conversation_errors
    def delete(self, request_context: RequestContext, installed_app: InstalledAppRef, c_id: UUID) -> tuple[str, int]:
        application_services().installed_app_conversations.delete(
            installed_app=installed_app, account_id=request_context.account_id, conversation_id=str(c_id)
        )
        return "", 204


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/name",
    endpoint="installed_app_conversation_rename",
)
class ConversationRenameApi(Resource):
    @console_ns.expect(console_ns.models[ConversationRenamePayload.__name__])
    @console_ns.response(200, "Conversation renamed successfully", console_ns.models[SimpleConversation.__name__])
    @console_account_admission()
    @get_installed_app
    @model_validate(ConversationRenamePayload)
    @_conversation_errors
    def post(
        self,
        payload: ConversationRenamePayload,
        request_context: RequestContext,
        installed_app: InstalledAppRef,
        c_id: UUID,
    ) -> dict[str, object]:
        conversation = application_services().installed_app_conversations.rename(
            installed_app=installed_app,
            account_id=request_context.account_id,
            conversation_id=str(c_id),
            name=payload.name,
            auto_generate=payload.auto_generate,
        )
        return dump_response(SimpleConversation, conversation)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/pin", endpoint="installed_app_conversation_pin"
)
class ConversationPinApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[ResultResponse.__name__])
    @console_account_admission()
    @get_installed_app
    @_conversation_errors
    def patch(self, request_context: RequestContext, installed_app: InstalledAppRef, c_id: UUID) -> dict[str, object]:
        application_services().installed_app_conversations.set_pinned(
            installed_app=installed_app,
            account_id=request_context.account_id,
            conversation_id=str(c_id),
            is_pinned=True,
        )
        return dump_response(ResultResponse, {"result": "success"})


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/unpin",
    endpoint="installed_app_conversation_unpin",
)
class ConversationUnPinApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[ResultResponse.__name__])
    @console_account_admission()
    @get_installed_app
    @_conversation_errors
    def patch(self, request_context: RequestContext, installed_app: InstalledAppRef, c_id: UUID) -> dict[str, object]:
        application_services().installed_app_conversations.set_pinned(
            installed_app=installed_app,
            account_id=request_context.account_id,
            conversation_id=str(c_id),
            is_pinned=False,
        )
        return dump_response(ResultResponse, {"result": "success"})
