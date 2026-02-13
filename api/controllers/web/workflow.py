"""
Web workflow endpoints (FastOpenAPI).

Notes:
- These routes are registered on `controllers.fastopenapi.web_router` and are intended for the
  FastOpenAPI PoC router mounted at `/api`.
- The FastOpenAPI router JSON-serializes non-Response results; return a Flask `Response` when
  streaming or custom headers are required.
"""

import logging
from typing import Any, Literal

from flask import Response
from pydantic import BaseModel, Field
from werkzeug.exceptions import InternalServerError

from controllers.fastopenapi import web_router
from controllers.web.error import (
    CompletionRequestError,
    NotWorkflowAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from controllers.web.wraps import decode_jwt_token
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_runtime.errors.invoke import InvokeError
from core.workflow.graph_engine.manager import GraphEngineManager
from libs import helper
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.errors.llm import InvokeRateLimitError


class WorkflowRunPayload(BaseModel):
    inputs: dict[str, Any] = Field(description="Input variables for the workflow")
    files: list[dict[str, Any]] | None = Field(default=None, description="Files to be processed by the workflow")


class WorkflowTaskStopResponse(BaseModel):
    result: Literal["success"] = Field(description="Operation result", examples=["success"])


logger = logging.getLogger(__name__)


@web_router.post(
    "/workflows/run",
    tags=["web"],
)
def run_workflow(payload: WorkflowRunPayload) -> Response:
    """
    Run workflow
    """
    app_model, end_user = decode_jwt_token()
    app_mode = AppMode.value_of(app_model.mode)
    if app_mode != AppMode.WORKFLOW:
        raise NotWorkflowAppError()

    args = payload.model_dump(exclude_none=True)

    try:
        response = AppGenerateService.generate(
            app_model=app_model, user=end_user, args=args, invoke_from=InvokeFrom.WEB_APP, streaming=True
        )

        return helper.compact_generate_response(response)
    except ProviderTokenNotInitError as ex:
        raise ProviderNotInitializeError(ex.description)
    except QuotaExceededError:
        raise ProviderQuotaExceededError()
    except ModelCurrentlyNotSupportError:
        raise ProviderModelCurrentlyNotSupportError()
    except InvokeError as e:
        raise CompletionRequestError(e.description)
    except InvokeRateLimitError as ex:
        raise InvokeRateLimitHttpError(ex.description)
    except ValueError as e:
        raise e
    except Exception:
        logger.exception("internal server error.")
        raise InternalServerError()


@web_router.post(
    "/workflows/tasks/<string:task_id>/stop",
    response_model=WorkflowTaskStopResponse,
    tags=["web"],
)
def stop_workflow_task(task_id: str) -> WorkflowTaskStopResponse:
    """
    Stop workflow task
    """
    app_model, _ = decode_jwt_token()
    app_mode = AppMode.value_of(app_model.mode)
    if app_mode != AppMode.WORKFLOW:
        raise NotWorkflowAppError()

    # Stop using both mechanisms for backward compatibility
    # Legacy stop flag mechanism (without user check)
    AppQueueManager.set_stop_flag_no_user_check(task_id)

    # New graph engine command channel mechanism
    GraphEngineManager.send_stop_command(task_id)

    return WorkflowTaskStopResponse(result="success")
