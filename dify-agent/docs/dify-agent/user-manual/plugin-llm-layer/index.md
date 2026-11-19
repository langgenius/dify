# Model module

`dify_agent.layers.dify_plugin.llm_layer` declares Config, State and Capability.
The reserved `llm` name selects model assembly. Public Config contains plugin,
provider, model, model settings, context window, `supported_modalities` and an
`execution_context` name. `supported_modalities` contains the credential-bound
model schema's supported input types: `vision`, `audio`, `video` and `document`.
It defaults to `[]`, so `read_media` returns text without attaching media when
the model has no declared multimodal support. Unsupported individual modalities
also return text before a model request is made.
The runtime builds a model through the Dify API metered gateway with borrowed
lifespan HTTP services. Credentials stay API-owned; no model/client is persisted.

If the gateway or provider rejects marked `read_media` content before the first
streamed chunk with HTTP 400, 413, 415 or 422, or a request-parameter error, the
runtime replaces those attachments with locator-bearing text and retries once.
Authentication, credentials, quota, missing-model and infrastructure failures
propagate normally. Failures after the first chunk and failures of the text
retry propagate without another retry.
