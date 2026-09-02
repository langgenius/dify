# pyright: reportImplicitRelativeImport=false, reportMissingImports=false
"""Run the plugin contract against its independently locked Dify Plugin SDK."""

from __future__ import annotations

import json
import socket

from dify_plugin.entities.model.message import PromptMessageTool, ToolPromptMessage, UserPromptMessage
from dify_plugin.errors.model import InvokeBadRequestError

from models.llm.contract import (
    MODEL_DELAY_SECONDS,
    MODEL_NAME,
    BenchmarkIdentity,
    build_benchmark_request,
)
from models.llm.llm import DifyAgentBenchmarkLargeLanguageModel


def _credentials() -> dict[str, object]:
    return {"benchmark_enabled": "enabled"}


def _request(scenario_id: str) -> str:
    return build_benchmark_request(
        BenchmarkIdentity(
            benchmark_run_id="invocation-123.run",
            scenario_id=scenario_id,
            scenario_version=1,
        )
    )


def _shell_tool() -> PromptMessageTool:
    return PromptMessageTool(
        name="shell_run",
        description="Execute the deterministic benchmark script",
        parameters={"type": "object", "properties": {"script": {"type": "string"}}},
    )


def main() -> None:
    delay_calls: list[float] = []

    def reject_network(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("deterministic model attempted a network connection")

    socket.socket.connect = reject_network  # type: ignore[method-assign]
    import models.llm.llm as llm_module

    llm_module.time.sleep = delay_calls.append
    model = DifyAgentBenchmarkLargeLanguageModel([])
    basic = list(
        model.invoke(
            model=MODEL_NAME,
            credentials=_credentials(),
            prompt_messages=[UserPromptMessage(content=_request("basic"))],
            stream=True,
        )
    )[0]
    first_round = list(
        model.invoke(
            model=MODEL_NAME,
            credentials=_credentials(),
            prompt_messages=[
                UserPromptMessage(content=_request("basic")),
                ToolPromptMessage(content="an earlier turn", tool_call_id="old-call"),
                UserPromptMessage(content=_request("shell")),
            ],
            tools=[_shell_tool()],
            stream=True,
        )
    )[0]
    second_round = list(
        model.invoke(
            model=MODEL_NAME,
            credentials=_credentials(),
            prompt_messages=[
                UserPromptMessage(content=_request("shell")),
                ToolPromptMessage(content="DIFY_BENCHMARK_SHELL_OK", tool_call_id="call-1"),
            ],
            tools=[_shell_tool()],
            stream=True,
        )
    )[0]
    invalid_error = ""
    try:
        list(
            DifyAgentBenchmarkLargeLanguageModel([]).invoke(
                model=MODEL_NAME,
                credentials=_credentials(),
                prompt_messages=[
                    UserPromptMessage(
                        content=(
                            'DIFY_BENCHMARK_REQUEST:{"benchmark_run_id":"../escape",'
                            '"scenario_id":"basic","scenario_version":1}'
                        )
                    )
                ],
                stream=True,
            )
        )
    except InvokeBadRequestError as exc:
        invalid_error = str(exc)
    disabled_error = ""
    try:
        list(
            DifyAgentBenchmarkLargeLanguageModel([]).invoke(
                model=MODEL_NAME,
                credentials={"benchmark_enabled": "disabled"},
                prompt_messages=[UserPromptMessage(content=_request("basic"))],
                stream=True,
            )
        )
    except InvokeBadRequestError as exc:
        disabled_error = str(exc)

    print(
        json.dumps(
            {
                "sdk_delay_calls": delay_calls,
                "expected_delay": MODEL_DELAY_SECONDS,
                "basic": basic.model_dump(mode="json"),
                "first_round": first_round.model_dump(mode="json"),
                "second_round": second_round.model_dump(mode="json"),
                "invalid_error": invalid_error,
                "disabled_error": disabled_error,
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
