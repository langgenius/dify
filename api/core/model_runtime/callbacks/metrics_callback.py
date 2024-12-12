from typing import Optional

from prometheus_client import Counter, Histogram

from configs import dify_config
from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.model_providers.__base.ai_model import AIModel

llm_model_request_total_counter = Counter(
    name="llm_model_request_total_counter",
    documentation="The total count of LLM model requests",
    labelnames=["model_type", "model"],
)
llm_model_request_failed_counter = Counter(
    name="llm_model_request_failed_counter",
    documentation="The failed count of LLM model requests",
    labelnames=["model_type", "model"],
)
llm_model_request_first_chunk_latency = Histogram(
    name="llm_model_request_first_chunk_latency",
    documentation="The first chunk latency of LLM model requests",
    unit="seconds",
    labelnames=["model_type", "model"],
    buckets=dify_config.HISTOGRAM_BUCKETS_1MIN,
)
llm_model_request_following_chunk_latency = Histogram(
    name="llm_model_request_following_chunk_latency",
    documentation="The following chunk latency of LLM model requests",
    unit="seconds",
    labelnames=["model_type", "model"],
    buckets=Histogram.DEFAULT_BUCKETS,
)
llm_model_request_entire_latency = Histogram(
    name="llm_model_request_entire_latency",
    documentation="The entire latency of LLM model requests",
    unit="seconds",
    labelnames=["model_type", "model"],
    buckets=dify_config.HISTOGRAM_BUCKETS_5MIN,
)


class MetricsCallback(Callback):
    first_chunk: bool = True

    def on_before_invoke(
        self,
        llm_instance: AIModel,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> None:
        llm_model_request_total_counter.labels(model_type=llm_instance.model_type.value, model=model).inc()

    def on_new_chunk(
        self,
        llm_instance: AIModel,
        chunk: LLMResultChunk,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ):
        # Skip the last one. The last one indicate the entire usage.
        if chunk.delta.finish_reason is not None:
            return

        if self.first_chunk:
            llm_model_request_first_chunk_latency.labels(model_type=llm_instance.model_type.value, model=model).observe(
                chunk.delta.usage.latency
            )
            self.first_chunk = False
        else:
            llm_model_request_following_chunk_latency.labels(
                model_type=llm_instance.model_type.value, model=model
            ).observe(chunk.delta.usage.latency)

    def on_after_invoke(
        self,
        llm_instance: AIModel,
        result: LLMResult,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> None:
        llm_model_request_entire_latency.labels(model_type=llm_instance.model_type.value, model=model).observe(
            result.usage.latency
        )

    def on_invoke_error(
        self,
        llm_instance: AIModel,
        ex: Exception,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> None:
        llm_model_request_failed_counter.labels(model_type=llm_instance.model_type.value, model=model).inc()
