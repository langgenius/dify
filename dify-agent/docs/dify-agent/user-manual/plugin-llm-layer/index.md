# Model module

`dify_agent.layers.dify_plugin.llm_layer` declares Config, State and Capability.
The reserved `llm` name selects model assembly. Public Config contains plugin,
provider, model, model settings, context window and an `execution_context` name.
The runtime builds a model through the Dify API metered gateway with borrowed
lifespan HTTP services. Credentials stay API-owned; no model/client is persisted.
