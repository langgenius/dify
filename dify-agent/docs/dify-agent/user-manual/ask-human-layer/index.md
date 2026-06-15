# Ask human layer

The ask human layer exposes one model-visible tool that lets an agent end the
current run with a structured request for human input. This page is for Dify
Agent clients that build `CreateRunRequest` payloads and then interpret terminal
run events.

The layer type id is `dify.ask_human`. It does not deliver forms, choose
recipients, enforce authorization, or wait inside the agent run. It only gives
the model a safe way to ask for human input and returns that request as a
deferred tool call.

## Layer contract

| Property | Value |
| --- | --- |
| Type id | `dify.ask_human` |
| Common layer name | `ask_human` |
| Config DTO | `DifyAskHumanLayerConfig` |
| Model-visible tool | `ask_human` by default, configurable with `tool_name` |
| Tool kind | pydantic-ai `external` deferred tool |
| Terminal event | `run_succeeded` |
| Terminal payload branch | `run_succeeded.data.deferred_tool_call` |

The agent run does not enter a paused status. When the model calls the ask-human
tool, the current run succeeds with a `deferred_tool_call` instead of normal
`output`. The client is responsible for turning that deferred call into its own
human-facing workflow, collecting a result, and starting another run with
`deferred_tool_results`.

## Basic usage

Add the ask human layer to the same composition as the prompt, history, LLM, and
optional structured-output layers:

```python {test="skip" lint="skip"}
from agenton_collections.layers.plain import PromptLayerConfig
from agenton_collections.layers.pydantic_ai import PYDANTIC_AI_HISTORY_LAYER_TYPE_ID
from dify_agent.layers.ask_human import DIFY_ASK_HUMAN_LAYER_TYPE_ID, DifyAskHumanLayerConfig
from dify_agent.layers.dify_plugin import DifyPluginLLMLayerConfig
from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID, DIFY_AGENT_MODEL_LAYER_ID
from dify_agent.protocol.schemas import CreateRunRequest, RunComposition, RunLayerSpec


request = CreateRunRequest(
    composition=RunComposition(
        layers=[
            RunLayerSpec(
                name="prompt",
                type="plain.prompt",
                config=PromptLayerConfig(
                    prefix="You can ask a human only when the missing decision is required to continue.",
                    user="Review the deployment plan and proceed only after getting the required approval.",
                ),
            ),
            RunLayerSpec(
                name=DIFY_AGENT_HISTORY_LAYER_ID,
                type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID,
            ),
            RunLayerSpec(
                name="ask_human",
                type=DIFY_ASK_HUMAN_LAYER_TYPE_ID,
                config=DifyAskHumanLayerConfig(
                    max_fields=4,
                    max_actions=2,
                    allowed_field_types=["paragraph", "select"],
                    allow_file_fields=False,
                ),
            ),
            RunLayerSpec(
                name=DIFY_AGENT_MODEL_LAYER_ID,
                type="dify.plugin.llm",
                config=DifyPluginLLMLayerConfig(
                    plugin_id="langgenius/openai",
                    model_provider="openai",
                    model="gpt-5.2",
                    credentials={"openai_api_key": "<redacted>"},
                ),
            ),
        ]
    )
)
```

Include a [history layer](../history-layer/index.md) whenever you expect to
resume after a human answer. The pending tool call is stored in pydantic-ai
message history, so the resumed run needs both the returned `session_snapshot`
and the same logical composition with the history layer still present.

## Config fields

`DifyAskHumanLayerConfig` controls the model-facing tool identity and guardrails.
It intentionally does not contain delivery settings.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | `bool` | `True` | When false, the layer exposes neither the tool nor the prompt guidance. |
| `tool_name` | `str` | `"ask_human"` | Model-visible tool name. Must be a valid identifier. |
| `tool_description` | `str \| None` | default description | Optional model-visible tool description. |
| `max_fields` | `int` | `8` | Maximum number of fields the model may request. Use `0` for action-only requests. |
| `max_actions` | `int` | `4` | Maximum number of human actions the model may request. |
| `allowed_field_types` | `list["paragraph" \| "select" \| "file" \| "file-list"]` | `["paragraph", "select"]` | Field types accepted by runtime validation. |
| `allow_file_fields` | `bool` | `False` | File field types are rejected unless this is true and the type is listed in `allowed_field_types`. |
| `max_markdown_chars` | `int` | `8000` | Maximum length for the optional `markdown` body. |
| `max_question_chars` | `int` | `1000` | Maximum length for the required `question`. |
| `max_field_label_chars` | `int` | `120` | Maximum label length for each field. |
| `max_action_label_chars` | `int` | `80` | Maximum label length for each action. |

Configured limits are also capped by server hard limits. If a config exceeds a
hard cap, request validation fails before the run can execute.

The layer converts these limits into a prompt hint automatically. Clients do not
need to write a separate system prompt listing the limits, although they may add
business-specific guidance such as when human input is appropriate.

## What the model can request

When enabled, the layer exposes an external deferred tool whose argument shape is
`AskHumanToolArgs`:

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | `str \| None` | Optional short title for the human request. |
| `question` | `str` | Required question/instruction for the human. |
| `markdown` | `str \| None` | Optional longer Markdown body. Treat it as untrusted user-visible content. |
| `fields` | `list[AskHumanField]` | Optional structured fields for the human to fill. |
| `actions` | `list[AskHumanAction]` | Optional action buttons. If omitted, Dify Agent normalizes to a single primary `Submit` action. |
| `urgency` | `"normal" \| "high"` | Hint for downstream systems; it is not a delivery policy. |

Supported field variants:

- `paragraph`: free-text input.
- `select`: single-choice input with unique option values.
- `file`: single-file input, only when file fields are allowed.
- `file-list`: multi-file input, only when file fields are allowed.

Tool arguments are validated again after the model calls the tool. Invalid calls
produce a model retry before a terminal success is emitted.

## Handling a deferred human request

Stream or poll run events as usual. A successful final answer has
`event.data.output`. A successful human request has `event.data.deferred_tool_call`.
Exactly one branch is set.

```python {test="skip" lint="skip"}
deferred_call = None
snapshot = None

async for event in client.stream_events(run_id):
    if event.type != "run_succeeded":
        continue
    snapshot = event.data.session_snapshot
    if event.data.deferred_tool_call is not None:
        deferred_call = event.data.deferred_tool_call
    else:
        final_output = event.data.output
    break

if deferred_call is not None:
    # Render your own human-facing form, enqueue notification, pause an outer
    # workflow, or store the request for later. Dify Agent does not do that part.
    print(deferred_call.tool_call_id, deferred_call.args)
```

A typical deferred payload looks like this:

```json
{
  "tool_call_id": "call_01H...",
  "tool_name": "ask_human",
  "args": {
    "title": "Deployment approval",
    "question": "Can we deploy version 2026.06.10 to production now?",
    "fields": [
      {
        "type": "paragraph",
        "name": "comment",
        "label": "Approval comment",
        "required": false
      }
    ],
    "actions": [
      {"id": "approve", "label": "Approve", "style": "primary"},
      {"id": "reject", "label": "Reject", "style": "destructive"}
    ],
    "urgency": "normal"
  },
  "metadata": {
    "layer_type": "dify.ask_human",
    "tool_name": "ask_human",
    "schema_version": 1
  }
}
```

The `args` object is model-generated content. Validate and sanitize it before
rendering it to end users.

## Resume with a human result

After your client collects a human answer, create a new run with:

- the previous `session_snapshot`;
- a matching composition that still includes the history and ask-human layers;
- `deferred_tool_results.calls[tool_call_id]` containing the human result.

```python {test="skip" lint="skip"}
from dify_agent.layers.ask_human import AskHumanToolResult
from dify_agent.protocol import DeferredToolResultsPayload


human_result = AskHumanToolResult(
    status="submitted",
    action={"id": "approve", "label": "Approve"},
    values={"comment": "Approved for the planned window."},
    message="The human approved the deployment.",
)

resume_request = CreateRunRequest(
    composition=composition_with_same_layer_names_and_order,
    session_snapshot=snapshot,
    deferred_tool_results=DeferredToolResultsPayload(
        calls={deferred_call.tool_call_id: human_result.model_dump(mode="json")},
    ),
)
```

Dify Agent passes the supplied result back to pydantic-ai as the return value of
the original external tool call, then the model continues. The resumed run may
produce a final `output`, or it may produce another `deferred_tool_call` if the
agent needs another human turn.

Timeouts and unavailable humans should also be sent as tool results instead of
being treated as agent-run failures:

```json
{
  "status": "timeout",
  "action": {"id": "__timeout", "label": "Timeout"},
  "values": {},
  "message": "The human did not respond before the workflow timeout."
}
```

## Client responsibilities

The ask human layer deliberately leaves product decisions to the caller. Clients
must decide how to:

- persist the deferred call and correlate it with a human-facing task;
- render and sanitize the requested fields/actions;
- choose recipients, channels, and timeout policy;
- authorize who may answer;
- transform the human submission into `AskHumanToolResult`;
- resume with the returned `session_snapshot` and matching composition.

Do not put recipient emails, workspace member ids, public URLs, auth tokens, or
timeout policy in the tool arguments. The model-facing request is untrusted and
should not control delivery or authorization.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Run fails with `Deferred tool results require a 'history' layer` | Add the `history` layer and resume with the prior snapshot. |
| Run fails with `pending tool call can be resumed` | Keep the history layer active for the initial deferred run. |
| Run fails with `exactly one deferred call` | The MVP supports one ask-human call per run. Ask the model to ask one question at a time. |
| Run fails with `tool name must be ...` | Use the configured `tool_name`; do not rename it only in downstream form code. |
| File fields are rejected | Set `allow_file_fields=True` and include `file` or `file-list` in `allowed_field_types`. |
| `run_succeeded.data.output` is absent | Check `run_succeeded.data.deferred_tool_call`; this is a human-request success, not a failed run. |
