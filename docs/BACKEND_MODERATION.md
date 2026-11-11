# Strict moderation for model invocations

`ModerationService.check` is a reusable use case for the existing `keywords`,
`openai_moderation`, and `api` capabilities. It receives an admitted
`AppRequestContext`, a `ModerationRule`, text, and an `input` or `output` phase.
It does not depend on Flask, persistence models, or app queue managers.

An enabled phase returns only after approval. Any flagged verdict raises
`ModerationRejectedError`, including API verdicts requesting replacement rather
than rejection. Backend failures propagate instead of silently approving text.
Disabled phases perform no moderation I/O. Strict policies are selected when
assembling models; matching app OpenAI rules reuse their verdicts and retain
configured replacement behavior.

## Automatic platform moderation

`HOSTED_MODERATION_ENABLED` controls automatic platform moderation in Cloud and
defaults to false. It takes effect only when `DEPLOYMENT_EDITION=CLOUD`, matching
the edition boundary used to assemble AI Credits quotas. Non-Cloud deployments
ignore the switch. When disabled or outside Cloud, no automatic policy is
constructed or injected. Explicit model policies and app-level keyword/API
moderation remain available in every edition. App-level Model Moderation is a
silent no-op when the model is not admitted for automatic AI-credit moderation;
enabling its app configuration does not select a tenant moderation provider.

When enabled,
Cloud LLMs using a system provider with a current `TRIAL` or `PAID`
credit-pool quota automatically receive input and output moderation.
This includes `CREDITS` and legacy `TIMES` quotas, which reserve one credit per call.
This applies to manager-created models, credential-cache hits, and direct `ModelInstance`
construction, including exhausted or unlimited credit quotas. Cloud custom-key,
non-LLM, and token-based quota modes do not receive this automatic policy.
Merely configuring a fallback identifier does not enable moderation.

For example, an operator can enable moderation and pin an optional fallback:

```dotenv
DEPLOYMENT_EDITION=CLOUD
HOSTED_MODERATION_ENABLED=true
HOSTED_OPENAI_API_KEY=<server-owned-api-key>
HOSTED_MODERATION_PLUGIN_UNIQUE_IDENTIFIER=langgenius/openai:<version>@<checksum>
```

The policy uses `langgenius/openai/openai` / `omni-moderation-latest` with the
server-owned `HOSTED_OPENAI_API_KEY` and optional OpenAI base/organization settings.
These credentials do not require enabling an OpenAI LLM trial/paid provider or
initializing Cloud hosting quotas. It first discovers the tenant's
`langgenius/openai/openai` provider and requires a Marketplace installation,
moderation capability, the official package identity, and a verified manifest.
If that route is absent, untrusted, or fails, it uses
`HOSTED_MODERATION_PLUGIN_UNIQUE_IDENTIFIER`, a pinned
`langgenius/openai:<version>@<checksum>` fallback supplied by SRE. A positive
violation verdict is final: it never triggers fallback to obtain another verdict.
The fallback identifier is validated only if needed; a working trusted tenant
plugin does not require it. Missing both routes, platform credentials, or a
working backend fails closed. A user's API key is never substituted.

The verified tenant route uses `/plugin/{tenant_id}/dispatch/moderation/invoke`,
which authorizes the plugin through the tenant's installation record. The SRE
fallback instead uses `/v2/invoke/dispatch/moderation/invoke` with a mandatory
`X-Plugin-Unique-Identifier` and the admitted `tenant_id` in JSON. Both routes
keep daemon server-key authentication, platform credentials, and pinned package
identity. An arbitrary client request cannot select direct dispatch or replace
the server-managed fallback identifier.

The v2 route is the daemon's existing direct-runtime invocation surface, originally
introduced for Slim remote CLI calls. It parses the supplied identifier, preserves
tenant execution context and cluster routing, and does not query tenant plugin
installations. It is not an installation endpoint or a public tenant API. The
fallback runtime must already be deployed and available to the daemon; direct
dispatch does not bootstrap a missing package. The fallback remains an SRE-owned
trust decision, while tenant-selected packages still require Marketplace and
verified-manifest checks. Moderation does not construct a
tenant model instance or enter `CreditPoolService`, so it neither reserves nor
deducts user credits. The target LLM retains its normal accounting, including
charging consumed usage when output is rejected.

The former `HostingModerationFeature` and `HOSTED_MODERATION_PROVIDERS` allowlist
have been removed. `HOSTED_MODERATION_ENABLED` controls the Cloud platform policy.
The old
random input-fragment check is replaced by complete segmented checks.

An explicitly supplied policy supplements enabled platform moderation rather
than disabling it. When the switch is off, only the explicit policy applies.

## App-level sharing and replacement

App generations create isolated tenant/app moderation sessions, shared only with
their worker contexts and response pipelines. App input and output checks use
the same `ModerationService` as model invocation: app-specific rules use
`evaluate`, while the platform OpenAI verdict path uses the strict `check`.
`check` rejects rather than applying a backend's replacement action;
`evaluate` returns replacement data only for the app pipeline. `keywords`,
`openai_moderation`, and `api` app rules therefore share one execution and
error boundary while preserving their backend-specific replacement data. App
OpenAI checks and the platform guard reuse exact same-phase input-segment
verdicts. An app output prefix already approved by one model stream does not
cause another OpenAI request. Arbitrary substrings, modified outputs, and
concatenations from unrelated streams are not treated as approved. No verdicts
are reused across app invocations or tenants.

App-level checks may proactively use platform credentials only when the app's
trusted main model qualifies for automatic AI-credit moderation. Enabling an
OpenAI app rule or the Cloud switch alone does not admit hosted checks. A
workflow has no single main model: each eligible model contributes its own
verdicts after assembly. Before model admission, or when app content has no
reusable platform verdict, the app model check silently does nothing. It never
falls back to a tenant moderation provider, incurs moderation credits, or raises
missing-plugin/credential errors for these skipped checks. Mixed credit/custom-key
workflows may reuse existing verdicts, but never use hosted credentials to check
unrelated content from custom-key nodes. Keyword and API app rules remain unchanged.

App generation binds the shared scope before input and output work starts. A
direct legacy caller without a bound scope retains the factory fallback; it is
not used by app generation and cannot share platform verdicts.

The plugin `/invoke/app` entry also binds a fresh scope before dispatching to
the app generator. Invocation validates tenant ownership before model work;
copied producer contexts and captured output evaluators retain that scope after
dispatch returns. Nested or subsequent requests never inherit its verdicts.

Sharing is process-local. Remote Agent LLM gateway calls do not inherit the app
session; local App Model Moderation cannot issue hosted or tenant checks without
admission and cannot infer reusable verdicts from remote text. Other configured
app rules remain independent. A client-provided approval flag must never be used
to skip platform checks across that boundary.

An enabled app OpenAI rule uses its nonblank phase-specific preset when the
platform rejects content. Chatbot, Chatflow, and legacy Agent Chat use the
English default `This message can’t be processed.` when no matching
preset is configured, including when app moderation or its phase is disabled.
The default is resolved at runtime, not written into the app configuration.
Other app moderation backends retain their own verdict and replacement rules;
their presets are not reused for a separate platform rejection.

Chat replies use the existing `message` or `message_replace` event followed by
`message_end`, without exposing the rejected segment. A replacement covers the
entire answer, including any previously delivered prefix, and the stored answer
matches the replacement. Rendering it does not invoke a model or estimate token
usage again. A failed chatflow retains its failed workflow status while rendering
the matching invocation-local rejection with its preset or default reply.
The reply and `message_end` precede the failed `workflow_finished` event because
the Redis/SSE subscriber stops reading at that terminal event; sending the reply
afterwards would persist it without ever delivering it to the WebApp client.

Unavailable checks are errors, not content verdicts, and never become replies.
Chatflow model guards record real unavailable failures in their invocation-local
session before workflow events stringify them. Only an exact recorded terminal
failure restores the typed `moderation_unavailable` error; matching text alone
cannot classify an unrelated failure or reuse another app invocation's state.
The error event precedes `workflow_finished` so public subscribers receive its
503 payload, while blocking requests raise the typed error for HTTP mapping.
This failure record is not a cached verdict and does not prevent later checks
from retrying. No unavailable check becomes a preset or default chat reply.
Explicit non-platform model policy failures are also preserved. Completion,
Workflow, RAG, and other non-chat paths retain the normal moderation error when
there is no matching preset. Remote New Agent errors retain their existing
transport handling; arbitrary upstream errors are not inferred to be platform
rejections from their text.

Platform rejections emit warning logs containing tenant, app, and phase.
Tenant-route failures also log fallback warnings. Moderated content and API keys
are never included in these log messages.

## App errors

Model-bound guards adapt moderation failures to the existing `AppGenerateError`
contract, so task error handling preserves them and response converters emit
the usual SSE `error` event. Console clients use their existing error toast:

| Condition | Code | Event status | Message |
| --- | --- | --- | --- |
| Content rejected | `moderation_rejected` | 400 | The configured rejection message, or the phase-specific fallback |
| Check unavailable or failed | `moderation_unavailable` | 503 | This message can’t be processed right now. Please try again later. |

These statuses describe the SSE error payload, not the HTTP status of an already
opened stream. Non-streaming requests on Console, Service API, and Web API return
the same codes and messages with the corresponding HTTP status. Check failures
retain their original cause in backend logs but
never expose platform credentials or plugin diagnostics to clients. Provider
generation failures retain their existing classification. When an error is
surfaced, approved segments remain visible; neither error delivers the rejected
or unchecked segment.
Chat apps may render a platform rejection using a matching preset or the default
reply described above instead of returning this error payload.

App output evaluation failures use the same `moderation_unavailable` contract.
The background worker publishes a terminal error and the response pipeline stops
consuming queued output, persists the message's error status, and emits the
existing error event. Final checks share a serialized evaluator and retain the
first failure: a later successful retry cannot turn an unavailable check into
approval. Already delivered app-level output is not retracted by this error;
platform model guards continue to check segments before delivery.

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
  sending one oversized moderation request. Each platform-checked prompt message has its own
  segment sequence; an identical app input can share a verdict without treating
  a substring of a different, composed prompt as approved.
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
- Models outside enabled automatic platform moderation retain their existing invocation and
  streaming behavior unless an explicit policy is supplied.

The API adapter loads tenant-scoped extension records in a short repository
session, then decrypts credentials and performs HTTP outside that session. It
requires an explicit boolean `flagged` field in every API verdict.

## RAG failure handling

`ModerationInvocationError` identifies model moderation failures without exposing
application-service dependencies to RAG consumers. Both rejection and service
unavailability remain terminal for the affected operation, not best-effort empty
results. Input failures precede model usage; output failures retain consumed
model charges.

QA formatting propagates moderation failures in preview and indexing mode.
Bounded worker futures return failures to the indexing coordinator, which marks
the document as errored instead of completing an empty or partial QA index.
Workers retain ten-chunk batches, so a failed batch does not submit subsequent
batches or incur further model calls for them.
Ordinary QA generation failures retain their existing best-effort handling.

Function-call dataset routing also propagates moderation failures. Ordinary
routing failures may still yield no selected dataset, but moderation failure
must never be interpreted as a successful empty retrieval.

Automatic metadata filtering in both legacy RAG and KnowledgeFS stops on
moderation failures instead of continuing with no automatic conditions.
KnowledgeFS emits a failed node event with the moderation exception type and
does not issue a retrieval request. Ordinary extraction and parsing failures
keep their existing fallback behavior.

Paragraph and parent-child summary previews preserve moderation failures from
their worker futures. Indexing-estimate adapters and application services pass
the shared moderation error contract through unchanged, so existing HTTP
handlers return `moderation_rejected` (400) or `moderation_unavailable` (503)
instead of a generic indexing-estimate error. Ordinary preview failures keep
their existing aggregated error messages.

Background summary generation records `ERROR` on the affected summary and does
not save or vectorize the failed LLM output. Other segments can still finish;
the original document's indexing status is independent of its summary status.
