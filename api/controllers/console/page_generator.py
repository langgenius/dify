"""AI-assisted page generator (isolated feature).

Standalone console endpoint that turns a natural-language description into a
single self-contained HTML document, streamed back token-by-token over SSE so
the frontend can render a live preview.

Design notes / boundaries:

- **Non-invasive**: this module owns its own prompt, payload model, and route.
  The only edit to existing code is a single entry in
  ``controllers.console.__init__.RESOURCE_MODULES`` so the route decorator runs.
- **Real LLM**: generation uses the tenant's *default* LLM instance via
  ``ModelManager.get_default_model_instance`` and ``invoke_llm(stream=True)``,
  mirroring ``core.llm_generator.llm_generator.LLMGenerator`` so no new model
  plumbing is introduced. There is no mock path.
- **SSE contract**: each chunk is emitted as ``data: {json}\\n\\n`` where the
  JSON carries an ``event`` field (``message`` / ``message_end`` / ``error``).
  This matches ``web/service/base.ts`` ``handleStream`` expectations so the
  frontend can reuse ``ssePost`` unchanged.

Errors from the model call are mapped to the same HTTP envelopes used by
``/rule-generate`` for consistency.
"""

import json
import logging
from collections.abc import Generator

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.console import console_ns
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.wraps import account_initialization_required, setup_required, with_current_tenant_id
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_manager import ModelManager
from graphon.model_runtime.entities.llm_entities import LLMResultChunk
from graphon.model_runtime.entities.message_entities import PromptMessage, SystemPromptMessage, UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeError
from libs.helper import compact_generate_response
from libs.login import login_required

logger = logging.getLogger(__name__)

# Upper bound for the free-text description. Generous for prose while keeping
# the prompt well inside every mainstream context window. Mirrored by the
# ``maxLength`` on the frontend textarea.
_MAX_DESCRIPTION_LENGTH = 4_000

# The system prompt constrains the model to a single self-contained HTML
# document so the frontend can drop the output straight into an iframe with no
# post-processing. Kept intentionally strict to avoid prose/markdown leakage.
_SYSTEM_PROMPT = """You are an expert front-end engineer. Generate a SINGLE, \
self-contained, production-quality HTML document for the page the user \
describes.

Hard requirements:
- Output ONLY raw HTML. No markdown fences, no explanations, no comments \
before or after the document.
- The document MUST start with <!DOCTYPE html> and be fully self-contained: \
inline all CSS in a <style> tag and any JS in a <script> tag. Do not reference \
external files.
- You MAY use CDN links for well-known libraries (e.g. Tailwind via CDN) when \
helpful, but prefer inline styles.
- Make it visually polished, responsive, and accessible.
- Use realistic placeholder copy relevant to the request."""


class PageGeneratePayload(BaseModel):
    """Request body for ``POST /console/api/page-generate``."""

    description: str = Field(
        ...,
        min_length=1,
        max_length=_MAX_DESCRIPTION_LENGTH,
        description="Natural-language description of the page to generate",
    )


@console_ns.route("/page-generate")
class PageGenerateApi(Resource):
    @console_ns.doc("generate_page")
    @console_ns.doc(description="Generate a self-contained HTML page from a description (streamed as SSE)")
    @console_ns.expect(console_ns.models.get(PageGeneratePayload.__name__))
    @console_ns.response(200, "HTML page streamed as text/event-stream")
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        args = PageGeneratePayload.model_validate(console_ns.payload)

        model_manager = ModelManager.for_tenant(tenant_id=current_tenant_id)
        model_instance = model_manager.get_default_model_instance(
            tenant_id=current_tenant_id,
            model_type=ModelType.LLM,
        )

        prompt_messages: list[PromptMessage] = [
            SystemPromptMessage(content=_SYSTEM_PROMPT),
            UserPromptMessage(content=args.description),
        ]

        try:
            # stream=True returns a generator of LLMResultChunk; we bridge it to
            # the SSE envelope the frontend already understands. The invoke call
            # itself is lazy, but resolving auth/quota errors happens on first
            # iteration, so we wrap iteration (not just the call) in the mapper.
            llm_stream = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={"temperature": 0.5},
                stream=True,
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)

        return compact_generate_response(_sse_from_llm_stream(llm_stream))


def _sse_from_llm_stream(
    llm_stream: Generator[LLMResultChunk, None, None],
) -> Generator[str, None, None]:
    """Adapt an ``invoke_llm(stream=True)`` generator into SSE lines.

    Emits ``message`` events carrying incremental ``answer`` text, a terminal
    ``message_end`` event, and — if the model raises mid-stream — an ``error``
    event so the frontend can surface it instead of hanging. Errors are handled
    inside the generator because the HTTP response has already started; we
    cannot switch to an error status code at that point.
    """
    try:
        for chunk in llm_stream:
            text = chunk.delta.message.get_text_content()
            if not text:
                continue
            yield "data: " + json.dumps({"event": "message", "answer": text}) + "\n\n"
        yield "data: " + json.dumps({"event": "message_end"}) + "\n\n"
    except InvokeError as e:
        logger.warning("page-generate: model invoke error mid-stream: %s", e.description)
        yield (
            "data: "
            + json.dumps({"event": "error", "code": "completion_request_error", "message": e.description})
            + "\n\n"
        )
    except Exception as e:
        logger.exception("page-generate: unexpected error during streaming")
        yield "data: " + json.dumps({"event": "error", "code": "internal_error", "message": str(e)}) + "\n\n"
