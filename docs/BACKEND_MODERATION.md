# Strict moderation for model invocations

`ModerationService.check` is a reusable use case for the existing `keywords`,
`openai_moderation`, and `api` capabilities. It receives an admitted
`AppRequestContext`, a `ModerationRule`, text, and an `input` or `output` phase.
It does not depend on Flask, persistence models, or app queue managers.

An enabled phase returns only after approval. Any flagged verdict raises
`ModerationRejectedError`, including API verdicts requesting replacement rather
than rejection. Backend failures propagate instead of silently approving text.
Disabled phases perform no moderation I/O. Existing app-level replacement behavior
is unchanged; strict policies are selected when assembling models.

## Automatic Cloud moderation

Cloud LLMs using a system provider with a current `TRIAL` or `PAID`
credit-pool quota automatically receive input and output moderation.
This includes `CREDITS` and legacy `TIMES` quotas, which reserve one credit per call.
This applies to manager-created models, credential-cache hits, and direct `ModelInstance`
construction, including exhausted or unlimited credit quotas. Non-Cloud
deployments and custom-key, non-LLM, or token-based
quota modes do not construct or inject this automatic policy.

The policy uses `langgenius/openai/openai` / `omni-moderation-latest` with the
existing hosted OpenAI credentials. SRE must set
`HOSTED_MODERATION_PLUGIN_UNIQUE_IDENTIFIER` to a usable, pinned
`langgenius/openai:<version>@<checksum>` package. Eligible model assembly fails
when the setting is absent or malformed; missing credentials and an unavailable
moderation backend also fail closed, with no fallback to a user's API key.

Moderation dispatches directly to the pinned plugin identifier with platform
credentials. It performs no tenant provider discovery or plugin-installation
lookup, so business tenants do not need to install the OpenAI plugin. The plugin
runtime must already be installed and loaded in plugin daemon; identifier
dispatch does not bootstrap a missing package. Moderation does not construct a
tenant model instance or enter `CreditPoolService`, so it neither reserves nor
deducts user credits. The target LLM retains its normal accounting, including
charging consumed usage when output is rejected.

The former `HostingModerationFeature` and its
`HOSTED_MODERATION_ENABLED` / `HOSTED_MODERATION_PROVIDERS` settings have been
removed. Its random input-fragment check is replaced by the complete,
output-aware policy above. Unknown legacy environment variables are ignored.

An explicitly supplied policy supplements mandatory Cloud moderation rather
than disabling it. Both policies must approve content.

## App errors

Model-bound guards adapt moderation failures to the existing `AppGenerateError`
contract, so task error handling preserves them and response converters emit
the usual SSE `error` event. Console clients use their existing error toast:

| Condition | Code | Event status | Message |
| --- | --- | --- | --- |
| Content rejected | `moderation_rejected` | 400 | The configured rejection message, or the phase-specific fallback |
| Check unavailable or failed | `moderation_unavailable` | 503 | Content moderation is temporarily unavailable. Please try again later. |

These statuses describe the SSE error payload, not the HTTP status of an already
opened stream. Non-streaming requests on Console, Service API, and Web API return
the same codes and messages with the corresponding HTTP status. Check failures
retain their original cause in backend logs but
never expose platform credentials or plugin diagnostics to clients. Provider
generation failures retain their existing classification. Approved segments
remain visible; neither error delivers the rejected or unchecked segment or
replaces the answer with an app-level preset response.

## Model invocation

Obtain the service from the composition root and bind the policy during model
assembly. Individual model invocations never accept a moderation override:

```python
from core.plugin.impl.model_runtime_factory import create_plugin_model_assembly
from extensions.application_services.moderation import build_llm_moderation_guard
from extensions.ext_application_services import application_services
from graphon.model_runtime.entities.model_entities import ModelType
from machinery.context import AppRequestContext
from services.moderation_service import ModerationRule

guard = build_llm_moderation_guard(
    AppRequestContext(tenant_id=tenant_id, app_id=app_id),
    service=application_services().moderation,
    rule=ModerationRule(
        type="keywords",
        config={
            "keywords": "blocked phrase\nanother phrase",
            "inputs_config": {"enabled": True, "preset_response": "Input rejected"},
            "outputs_config": {"enabled": True, "preset_response": "Output rejected"},
        },
    ),
)

assembly = create_plugin_model_assembly(tenant_id=tenant_id, moderation=guard)
model_instance = assembly.model_manager.get_model_instance(
    tenant_id=tenant_id,
    provider=provider,
    model_type=ModelType.LLM,
    model=model_name,
)
result = model_instance.invoke_llm(prompt_messages=prompt_messages, stream=False)
```

Use the same configuration shape as app moderation. OpenAI uses
`type="openai_moderation"`; API extensions use `type="api"` with
`api_based_extension_id` scoped to the admitted tenant. An empty `app_id` is
allowed for non-app invocations; API extensions receive it unchanged. The guard
snapshots the configuration so later caller mutations cannot disable its checks.

`ModelManager.for_tenant(..., moderation=guard)`,
`create_plugin_model_manager(..., moderation=guard)`, and direct
`ModelInstance(..., moderation=guard)` construction support the same binding.
The policy follows every manager-created LLM, including cached credentials and
default-model resolution. It is exposed read-only on the instance, and mismatched
tenant bindings fail before credential resolution. Non-LLM capabilities do not
inherit LLM policies, so moderation-model calls do not recursively moderate themselves.

The assembly owner supplies a trusted scope for explicit policies. Automatic
selection uses trusted deployment and provider quota configuration, never
caller-provided request metadata. Raw plugin runtime/client interfaces remain
infrastructure, not moderated business entry points.

## Guarantees and trade-offs

- Input checks precede model invocation and quota reservation. All prompt roles,
  text parts of multimodal messages, and assistant tool arguments are inspected
  as independent non-stream segments, so long prompts are fully covered without
  sending one oversized moderation request.
- Opaque Agent gateway dictionaries are inspected through validated copies. The
  original payload and provider-specific extension fields are forwarded unchanged.
- Output checks inspect completion text, tool arguments, and native structured
  payloads even when their message text is empty. Binary image, audio,
  video, and document content is not inspected by these text moderation backends.
- Non-stream output is checked in independent segments of
  `MODERATION_NON_STREAM_SEGMENT_SIZE` characters. Every segment must pass before
  the original result is returned.
- Streaming output is buffered until it reaches
  `MODERATION_BUFFER_SIZE` characters, then checked before its original
  chunks are released. The final partial segment is also checked before release.
  Provider chunks are kept intact, so a segment can exceed the configured threshold.
  A later rejection stops the stream and preserves earlier delivered segments;
  current model-level consumers cannot retract those bytes.
- Segmentation is the moderation boundary: each segment is checked independently,
  without carrying text across segment boundaries or rechecking the full document
  at completion. Content requiring cross-segment context may not be detected.
  Defaults are 2000 characters for input and non-stream output, and a 300-character
  buffering threshold for streaming output in both app-level and model-level moderation.
- Consumed model usage is settled before output checking, including rejected
  completions. A provider or moderation error is not an approval or a model retry.
- Structured output automatically uses the policy of its model instance. Workflow
  polling applies that same policy before task submission and to successful terminal
  results, after settling usage. Rejected inputs neither submit a task nor reserve
  model quota; rejected successful outputs do not refund consumed quota.
- The guard protects returned results, not provider-level observer callbacks.
  Callbacks must not independently publish unmoderated model content.
- Models outside automatic Cloud moderation retain their existing invocation and
  streaming behavior unless an explicit policy is supplied.

The API adapter loads tenant-scoped extension records in a short repository
session, then decrypts credentials and performs HTTP outside that session. It
requires an explicit boolean `flagged` field in every API verdict.
