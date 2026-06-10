"""Runtime ask-human layer built on pydantic-ai external deferred tools.

The layer contributes one optional external tool plus one prompt hint. The tool
never executes Python during the initial run; instead the model emits an
external deferred tool call that Dify Agent returns through ``run_succeeded`` as
``deferred_tool_call``. Guardrails are enforced in two places:

* prompt/tool-definition guidance nudges the model toward valid requests, and
* runtime validation normalizes default actions and rejects out-of-policy calls.

The layer stays product-neutral: downstream systems decide delivery, recipients,
timeouts, and authorization for the human request.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, ClassVar, cast

from pydantic import JsonValue, ValidationError
from pydantic_ai import Tool
from pydantic_ai.exceptions import ModelRetry
from pydantic_ai.tools import DeferredToolRequests, RunContext, ToolDefinition
from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, NoLayerDeps, PydanticAILayer, PydanticAIPrompt, PydanticAITool
from dify_agent.layers.ask_human.configs import DIFY_ASK_HUMAN_LAYER_TYPE_ID, DifyAskHumanLayerConfig
from dify_agent.layers.ask_human.schema import (
    AskHumanAction,
    AskHumanField,
    AskHumanToolArgs,
)
from dify_agent.protocol.schemas import DeferredToolCallPayload, RunComposition


_ASK_HUMAN_DEFERRED_SCHEMA_VERSION = 1
_DEFAULT_SUBMIT_ACTION = AskHumanAction(id="submit", label="Submit", style="primary")


@dataclass(slots=True)
class DifyAskHumanLayer(PydanticAILayer[NoLayerDeps, object, DifyAskHumanLayerConfig, EmptyRuntimeState]):
    """State-free pydantic-ai layer that exposes the ask-human deferred tool."""

    type_id: ClassVar[str | None] = DIFY_ASK_HUMAN_LAYER_TYPE_ID

    config: DifyAskHumanLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyAskHumanLayerConfig) -> Self:
        """Create the layer from validated public config."""
        return cls(config=DifyAskHumanLayerConfig.model_validate(config))

    @property
    @override
    def prefix_prompts(self) -> list[PydanticAIPrompt[object]]:
        if not self.config.enabled:
            return []
        return [self.build_prompt_hint]

    @property
    @override
    def tools(self) -> list[PydanticAITool[object]]:
        if not self.config.enabled:
            return []
        return [
            Tool(
                self._never_executed_tool,
                takes_ctx=True,
                name=self.config.tool_name,
                description=self.config.effective_tool_description,
                prepare=self._prepare_tool_definition,
                args_validator=self._validate_tool_args,
                sequential=True,
            )
        ]

    def build_prompt_hint(self) -> str:
        """Return the model-facing instruction text for ask-human guardrails."""
        allowed_field_types = ", ".join(self.config.allowed_field_types) if self.config.allowed_field_types else "none"
        file_field_status = "enabled" if self.config.allow_file_fields else "disabled"
        if self.config.max_fields == 0:
            field_count_hint = "Do not add any fields."
        else:
            field_count_hint = f"Use at most {self.config.max_fields} field(s)."
        return (
            f"You may call the external tool '{self.config.tool_name}' only when human input is required to continue. "
            "Do not ask a human for information that can be inferred from the conversation, current context, or other tools.\n\n"
            f"Ask-human guardrails:\n"
            f"- Allowed field types: {allowed_field_types}.\n"
            f"- File upload fields are {file_field_status}.\n"
            f"- {field_count_hint}\n"
            f"- Use at most {self.config.max_actions} action(s).\n"
            f"- Keep 'question' under {self.config.max_question_chars} characters.\n"
            f"- Keep 'markdown' under {self.config.max_markdown_chars} characters.\n"
            f"- Keep each field label under {self.config.max_field_label_chars} characters.\n"
            f"- Keep each action label under {self.config.max_action_label_chars} characters.\n"
            "- If you omit actions, the system will add one primary action: Submit.\n"
            "Prefer concise, structured requests that stay comfortably within these limits."
        )

    def build_deferred_tool_call_payload(self, requests: DeferredToolRequests) -> DeferredToolCallPayload:
        """Validate and normalize the single supported deferred ask-human call."""
        if requests.approvals:
            raise ValueError("ask_human does not support approval requests; use external deferred calls only")

        call_count = len(requests.calls)
        if call_count != 1:
            raise ValueError(f"ask_human supports exactly one deferred call per run in this version; got {call_count}.")

        call = requests.calls[0]
        if call.tool_name != self.config.tool_name:
            raise ValueError(f"ask_human deferred tool name must be '{self.config.tool_name}', got '{call.tool_name}'.")

        args = self._validate_and_normalize_tool_args(
            title=None,
            question="",
            markdown=None,
            fields=[],
            actions=[],
            urgency="normal",
            raw_args=call.args,
        )
        return DeferredToolCallPayload(
            tool_call_id=call.tool_call_id,
            tool_name=call.tool_name,
            args=cast(JsonValue, args.model_dump(mode="json")),
            metadata={
                "layer_type": self.type_id,
                "tool_name": self.config.tool_name,
                "schema_version": _ASK_HUMAN_DEFERRED_SCHEMA_VERSION,
            },
        )

    def _prepare_tool_definition(self, _ctx: RunContext[object], tool_def: ToolDefinition) -> ToolDefinition:
        """Convert the ask-human tool into a pydantic-ai external deferred tool."""
        del tool_def
        return ToolDefinition(
            name=self.config.tool_name,
            description=self.config.effective_tool_description,
            parameters_json_schema=cast(dict[str, Any], AskHumanToolArgs.model_json_schema()),
            strict=False,
            sequential=True,
            kind="external",
        )

    async def _never_executed_tool(
        self,
        _ctx: RunContext[object],
        *,
        title: str | None = None,
        question: str,
        markdown: str | None = None,
        fields: list[AskHumanField] | None = None,
        actions: list[AskHumanAction] | None = None,
        urgency: str = "normal",
    ) -> str:
        del title, question, markdown, fields, actions, urgency
        raise RuntimeError("ask_human is an external deferred tool and should not execute during the initial run")

    def _validate_tool_args(
        self,
        _ctx: RunContext[object],
        *,
        title: str | None = None,
        question: str,
        markdown: str | None = None,
        fields: list[AskHumanField] | None = None,
        actions: list[AskHumanAction] | None = None,
        urgency: str = "normal",
    ) -> None:
        try:
            _ = self._validate_and_normalize_tool_args(
                title=title,
                question=question,
                markdown=markdown,
                fields=fields or [],
                actions=actions or [],
                urgency=urgency,
            )
        except (ValidationError, ValueError) as exc:
            raise ModelRetry(str(exc)) from exc

    def _validate_and_normalize_tool_args(
        self,
        *,
        title: str | None,
        question: str,
        markdown: str | None,
        fields: list[AskHumanField],
        actions: list[AskHumanAction],
        urgency: str,
        raw_args: str | dict[str, Any] | None = None,
    ) -> AskHumanToolArgs:
        if raw_args is not None:
            args = _validate_tool_args_payload(raw_args)
        else:
            args = AskHumanToolArgs(
                title=title,
                question=question,
                markdown=markdown,
                fields=fields,
                actions=actions,
                urgency=cast(Any, urgency),
            )

        if len(args.fields) > self.config.max_fields:
            raise ValueError(f"ask_human fields must contain at most {self.config.max_fields} item(s)")

        normalized_actions = list(args.actions)
        if not normalized_actions:
            normalized_actions = [_DEFAULT_SUBMIT_ACTION.model_copy()]
        if len(normalized_actions) > self.config.max_actions:
            raise ValueError(f"ask_human actions must contain at most {self.config.max_actions} item(s)")

        if len(args.question) > self.config.max_question_chars:
            raise ValueError(f"ask_human question must be <= {self.config.max_question_chars} characters")
        if args.markdown is not None and len(args.markdown) > self.config.max_markdown_chars:
            raise ValueError(f"ask_human markdown must be <= {self.config.max_markdown_chars} characters")

        allowed_field_types = set(self.config.allowed_field_types)
        for field in args.fields:
            if field.type not in allowed_field_types:
                raise ValueError(f"ask_human field type '{field.type}' is not allowed by this layer config")
            if len(field.label) > self.config.max_field_label_chars:
                raise ValueError(
                    f"ask_human field label '{field.label}' must be <= {self.config.max_field_label_chars} characters"
                )
            if not self.config.allow_file_fields and field.type in {"file", "file-list"}:
                raise ValueError("ask_human file fields are disabled by this layer config")

        for action in normalized_actions:
            if len(action.label) > self.config.max_action_label_chars:
                raise ValueError(
                    f"ask_human action label '{action.label}' must be <= {self.config.max_action_label_chars} characters"
                )

        return args.model_copy(update={"actions": normalized_actions})


def validate_ask_human_layer_composition(composition: RunComposition) -> None:
    """Reject unsupported public ask-human layer graph shapes."""
    ask_human_layers = [layer.name for layer in composition.layers if layer.type == DIFY_ASK_HUMAN_LAYER_TYPE_ID]
    if len(ask_human_layers) > 1:
        names = ", ".join(ask_human_layers)
        raise ValueError(f"Only one '{DIFY_ASK_HUMAN_LAYER_TYPE_ID}' layer is supported. Found layers: {names}.")


def get_ask_human_layer(run: Any) -> DifyAskHumanLayer | None:
    """Return the active ask-human layer when one is present and enabled."""
    matched: list[DifyAskHumanLayer] = []
    for slot in run.slots.values():
        layer = slot.layer
        if isinstance(layer, DifyAskHumanLayer):
            matched.append(layer)
    if not matched:
        return None
    if len(matched) > 1:
        raise ValueError(f"Only one '{DIFY_ASK_HUMAN_LAYER_TYPE_ID}' layer is supported per run.")

    layer = matched[0]
    return layer if layer.config.enabled else None


def _validate_tool_args_payload(raw_args: str | dict[str, Any]) -> AskHumanToolArgs:
    if isinstance(raw_args, str):
        return AskHumanToolArgs.model_validate_json(raw_args or "{}")
    return AskHumanToolArgs.model_validate(raw_args or {})


__all__ = [
    "DifyAskHumanLayer",
    "get_ask_human_layer",
    "validate_ask_human_layer_composition",
]
