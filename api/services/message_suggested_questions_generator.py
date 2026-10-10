"""Generate suggested questions after all conversation query sessions close."""

import logging
from collections.abc import Callable, Generator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING, cast

from flask import current_app

from core.app.entities.app_invoke_entities import CreditUsageCreatedBy, get_credit_usage_app_type
from core.llm_generator.llm_generator import _normalize_completion_params
from core.llm_generator.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.model_context import use_credit_usage_metadata, with_credit_usage_created_by
from core.model_manager import ModelInstance, ModelManager
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.utils import measure_time
from core.plugin.impl.base import use_plugin_daemon_request_timeout
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from extensions.ext_database import db
from graphon.model_runtime.entities.llm_entities import LLMResult
from graphon.model_runtime.entities.message_entities import PromptMessage, UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType, ParameterType

if TYPE_CHECKING:
    from core.memory.token_buffer_memory import PreparedHistory
    from services.message_suggested_questions_service import SuggestedQuestionsContext

logger = logging.getLogger(__name__)

_SUGGESTED_QUESTIONS_MAX_TOKENS = 256
_SUGGESTED_QUESTIONS_TIMEOUT_SECONDS = 30.0
_LOW_REASONING_EFFORTS = ("none", "minimal", "low")


@dataclass(frozen=True)
class PreparedSuggestedQuestionsModel:
    """Resolved model credentials; ``None`` parameters select the default-model tuning."""

    model_instance: ModelInstance
    completion_params: dict[str, object] | None


def _default_suggested_questions_model_parameters(model_instance: ModelInstance) -> dict[str, object]:
    """Build a low-latency parameter set for the workspace default model."""
    parameters: dict[str, object] = {
        "max_tokens": _SUGGESTED_QUESTIONS_MAX_TOKENS,
        "temperature": 0.0,
    }

    try:
        model_schema = model_instance.get_model_schema()
    except Exception:
        logger.warning("Failed to inspect the default model schema for suggested questions", exc_info=True)
        return parameters

    parameter_rules = {rule.name: rule for rule in model_schema.parameter_rules}
    thinking_rule = parameter_rules.get("thinking")
    if thinking_rule is not None:
        if thinking_rule.type == ParameterType.BOOLEAN:
            parameters["thinking"] = False
            return parameters
        if "disabled" in thinking_rule.options:
            parameters["thinking"] = "disabled"
            return parameters

    reasoning_effort_rule = parameter_rules.get("reasoning_effort")
    if reasoning_effort_rule is not None:
        for effort in _LOW_REASONING_EFFORTS:
            if effort in reasoning_effort_rule.options:
                parameters["reasoning_effort"] = effort
                break

    return parameters


class SuggestedQuestionsGenerator:
    """Own model resolution, detached-history rendering, generation and tracing."""

    @contextmanager
    def prepare(
        self,
        *,
        context: "SuggestedQuestionsContext",
        instruction_prompt: str | None,
        model_config: object | None,
    ) -> Generator[Callable[["PreparedHistory"], list[str]] | None]:
        """Yield a request-local generator, or None if its history model is unavailable."""
        # Model resolution and tracing may use or commit the scoped session.
        # Isolate them from the caller, retaining one app context across phases.
        with current_app.app_context():
            history_model = self._get_history_model(tenant_id=context.tenant_id)
            db.session.remove()
            if history_model is None:
                yield None
            else:
                yield partial(
                    self.generate,
                    history_model=history_model,
                    context=context,
                    instruction_prompt=instruction_prompt,
                    model_config=model_config,
                )

    def generate(
        self,
        history: "PreparedHistory",
        *,
        history_model: ModelInstance,
        context: "SuggestedQuestionsContext",
        instruction_prompt: str | None,
        model_config: object | None,
    ) -> list[str]:
        """Consume detached history within the isolation scope opened by prepare()."""
        histories = history.get_prompt_text(model_instance=history_model, max_token_limit=3000)

        with (
            measure_time() as timer,
            use_credit_usage_metadata({"app_type": get_credit_usage_app_type(context.app_mode)}),
        ):
            model = self._prepare_model(tenant_id=context.tenant_id, model_config=model_config)
            db.session.remove()
            questions = (
                list(self._invoke(prepared_model=model, histories=histories, instruction_prompt=instruction_prompt))
                if model is not None
                else []
            )

        # Invocation catches provider failures, including failed database
        # transactions. Tracing always starts with a fresh scoped session.
        db.session.remove()
        TraceQueueManager(app_id=context.app_id).add_trace_task(
            TraceTask(
                TraceTaskName.SUGGESTED_QUESTION_TRACE,
                message_id=context.message_id,
                suggested_question=questions,
                timer=timer,
            )
        )
        return questions

    @staticmethod
    def _get_history_model(*, tenant_id: str) -> ModelInstance | None:
        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
        try:
            return model_manager.get_default_model_instance(tenant_id=tenant_id, model_type=ModelType.LLM)
        except Exception:
            logger.exception("Failed to resolve the history model for suggested questions")
            return None

    @classmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.SUGGESTED_QUESTIONS)
    def _prepare_model(
        cls,
        tenant_id: str,
        *,
        model_config: object | None = None,
    ) -> PreparedSuggestedQuestionsModel | None:
        """Resolve the model before its caller releases database sessions.

        ``None`` means no usable configured or default model was found. Schema
        inspection and generation belong to invocation, after the read phase.
        """
        try:
            model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
            configured_model = cast(dict[str, object], model_config) if isinstance(model_config, dict) else {}
            provider = configured_model.get("provider")
            model_name = configured_model.get("name")
            use_configured_model = False

            if isinstance(provider, str) and provider and isinstance(model_name, str) and model_name:
                try:
                    model_instance = model_manager.get_model_instance(
                        tenant_id=tenant_id,
                        model_type=ModelType.LLM,
                        provider=provider,
                        model=model_name,
                    )
                    use_configured_model = True
                except Exception:
                    logger.warning(
                        "Failed to use configured suggested-questions model %s/%s, fallback to default model",
                        provider,
                        model_name,
                        exc_info=True,
                    )
                    model_instance = model_manager.get_default_model_instance(
                        tenant_id=tenant_id,
                        model_type=ModelType.LLM,
                    )
            else:
                model_instance = model_manager.get_default_model_instance(
                    tenant_id=tenant_id,
                    model_type=ModelType.LLM,
                )
        except Exception:
            logger.exception("Failed to resolve the suggested-questions model")
            return None

        completion_params: dict[str, object] | None = None
        if use_configured_model:
            configured_completion_params = configured_model.get("completion_params")
            completion_params = (
                dict(configured_completion_params) if isinstance(configured_completion_params, dict) else {}
            )
        return PreparedSuggestedQuestionsModel(
            model_instance=model_instance,
            completion_params=completion_params,
        )

    @classmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.SUGGESTED_QUESTIONS)
    def _invoke(
        cls,
        prepared_model: PreparedSuggestedQuestionsModel,
        histories: str,
        *,
        instruction_prompt: str | None = None,
    ) -> Sequence[str]:
        """Generate with an already resolved model without repeating model resolution."""
        output_parser = SuggestedQuestionsAfterAnswerOutputParser(instruction_prompt=instruction_prompt)
        format_instructions = output_parser.get_format_instructions()
        prompt_template = PromptTemplateParser(template="{{histories}}\n{{format_instructions}}\nquestions:\n")
        prompt = prompt_template.format({"histories": histories, "format_instructions": format_instructions})

        prompt_messages: list[PromptMessage] = [UserPromptMessage(content=prompt)]

        questions: Sequence[str] = []

        try:
            model_parameters: dict[str, object]
            stop: list[str]
            model_instance = prepared_model.model_instance
            if prepared_model.completion_params is not None:
                model_parameters, stop = _normalize_completion_params(prepared_model.completion_params)
            else:
                # Default-model generation keeps the built-in suggested-questions tuning.
                model_parameters = _default_suggested_questions_model_parameters(model_instance)
                stop = []

            with use_plugin_daemon_request_timeout(_SUGGESTED_QUESTIONS_TIMEOUT_SECONDS):
                response: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(prompt_messages),
                    model_parameters=model_parameters,
                    stop=stop,
                    stream=False,
                )

            text_content = response.message.get_text_content()
            questions = output_parser.parse(text_content) if text_content else []
        except Exception:
            logger.exception("Failed to generate suggested questions after answer")
            questions = []

        return questions
