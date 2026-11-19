"""Shared fixtures for the ``decision`` node unit tests."""

from collections.abc import Generator, Mapping, Sequence
from decimal import Decimal
from typing import Literal, Protocol, overload, override

import pytest

from core.workflow.nodes.decision.entities import DecisionNodeData
from core.workflow.nodes.decision.node import DecisionNode
from graphon.file import File, FileType
from graphon.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMResultChunkWithStructuredOutput,
    LLMResultWithStructuredOutput,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, PromptMessageTool
from graphon.model_runtime.entities.model_entities import AIModelEntity
from graphon.nodes.llm.file_saver import LLMFileSaver
from graphon.nodes.llm.runtime_protocols import LLMProtocol
from graphon.runtime import RuntimeState
from graphon.variables.variables import Variable
from tests.workflow_test_utils import build_test_graph_init_params, build_test_variable_pool


class FakeDecisionModel(LLMProtocol):
    """Minimal ``LLMProtocol`` implementation that returns one canned reply.

    ``invoke_llm`` honours the protocol's ``stream`` contract: a streamed call
    yields the reply as one chunk carrying the usage, a blocking call returns
    it as one ``LLMResult``. The structured-output and token-counting members
    are never reached by the decision node and fail loudly if they are.
    """

    def __init__(self, text: str, *, usage: LLMUsage | None = None, error: Exception | None = None) -> None:
        self.text = text
        self.usage = usage or LLMUsage.empty_usage()
        self.error = error
        self._parameters: Mapping[str, object] = {}
        self.prompt_messages: Sequence[PromptMessage] = []

    @property
    @override
    def provider(self) -> str:
        return "fake-provider"

    @property
    @override
    def model_name(self) -> str:
        return "fake-model"

    @property
    @override
    def parameters(self) -> Mapping[str, object]:
        return self._parameters

    @parameters.setter
    @override
    def parameters(self, value: Mapping[str, object]) -> None:
        self._parameters = value

    @property
    @override
    def stop(self) -> Sequence[str] | None:
        return None

    @override
    def get_model_schema(self) -> AIModelEntity:
        raise AssertionError("the decision node never reads the model schema")

    @override
    def get_llm_num_tokens(self, prompt_messages: Sequence[PromptMessage]) -> int:
        _ = prompt_messages
        raise AssertionError("the decision node never counts tokens")

    @overload
    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, object],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[False],
    ) -> LLMResult: ...

    @overload
    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, object],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[True],
    ) -> Generator[LLMResultChunk]: ...

    @override
    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, object],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: bool,
    ) -> LLMResult | Generator[LLMResultChunk]:
        _ = model_parameters, tools, stop
        if self.error is not None:
            raise self.error
        self.prompt_messages = prompt_messages
        if stream:
            return self._stream_reply(prompt_messages)
        return LLMResult(
            model=self.model_name,
            prompt_messages=list(prompt_messages),
            message=AssistantPromptMessage(content=self.text),
            usage=self.usage,
        )

    def _stream_reply(self, prompt_messages: Sequence[PromptMessage]) -> Generator[LLMResultChunk]:
        yield LLMResultChunk(
            model=self.model_name,
            prompt_messages=list(prompt_messages),
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=self.text),
                usage=self.usage,
                finish_reason="stop",
            ),
        )

    @overload
    def invoke_llm_with_structured_output(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        json_schema: Mapping[str, object],
        model_parameters: Mapping[str, object],
        stop: Sequence[str] | None,
        stream: Literal[False],
    ) -> LLMResultWithStructuredOutput: ...

    @overload
    def invoke_llm_with_structured_output(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        json_schema: Mapping[str, object],
        model_parameters: Mapping[str, object],
        stop: Sequence[str] | None,
        stream: Literal[True],
    ) -> Generator[LLMResultChunkWithStructuredOutput]: ...

    @override
    def invoke_llm_with_structured_output(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        json_schema: Mapping[str, object],
        model_parameters: Mapping[str, object],
        stop: Sequence[str] | None,
        stream: bool,
    ) -> LLMResultWithStructuredOutput | Generator[LLMResultChunkWithStructuredOutput]:
        _ = prompt_messages, json_schema, model_parameters, stop, stream
        raise AssertionError("the decision node never asks for structured output")

    @override
    def is_structured_output_parse_error(self, error: Exception) -> bool:
        _ = error
        return False


class UnusedFileSaver(LLMFileSaver):
    """A saver that must never be reached: the fake model only returns text."""

    def save_binary_string(
        self,
        data: bytes,
        mime_type: str,
        file_type: FileType,
        extension_override: str | None = None,
    ) -> File:
        _ = data, mime_type, file_type, extension_override
        raise AssertionError("the fake model never returns files")

    def save_remote_url(self, url: str, file_type: FileType) -> File:
        _ = url, file_type
        raise AssertionError("the fake model never returns files")


def build_usage(*, total_tokens: int = 15) -> LLMUsage:
    return LLMUsage.empty_usage().model_copy(
        update={
            "prompt_tokens": total_tokens - 5,
            "completion_tokens": 5,
            "total_tokens": total_tokens,
            "total_price": Decimal("0.5"),
            "currency": "USD",
        }
    )


class DecisionNodeBuilder(Protocol):
    """Signature of the ``build_decision_node`` fixture."""

    def __call__(
        self,
        data: Mapping[str, object],
        *,
        variables: Sequence[Variable] = (),
        model_instance: LLMProtocol | None = None,
        llm_file_saver: LLMFileSaver | None = None,
    ) -> DecisionNode: ...


@pytest.fixture
def build_decision_node() -> DecisionNodeBuilder:
    """Build a ``DecisionNode`` with a variable pool holding ``variables``."""

    def _build(
        data: Mapping[str, object],
        *,
        variables: Sequence[Variable] = (),
        model_instance: LLMProtocol | None = None,
        llm_file_saver: LLMFileSaver | None = None,
    ) -> DecisionNode:
        runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=build_test_variable_pool(variables=list(variables)),
            start_at=0,
        )
        return DecisionNode(
            node_id="decision",
            data=DecisionNodeData.model_validate(dict(data)),
            init_params=build_test_graph_init_params(workflow_id="test-workflow"),
            runtime_state=runtime_state,
            model_instance=model_instance,
            llm_file_saver=llm_file_saver,
        )

    return _build
