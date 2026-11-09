<!-- knowledge
last_checked: "2026-09-08T17:04:02Z"
-->
# Model Runtime

This package defines provider schemas, credential validation, capability-specific
runtime contracts, and model wrappers. Host applications supply concrete runtime
adapters; any provider-selection or credential UI belongs to the host.

For graph-facing LLM nodes, start with
[LLMProtocol](../nodes/llm/runtime_protocols.py) and
[SlimLLM](../dsl/slim/llm.py). Those adapters are distinct from the provider and
capability wrappers described below.

## Features

- Supports capability invocation for 6 types of models

  - `LLM` - LLM text completion, dialogue, pre-computed tokens capability
  - `Text Embedding Model` - Text Embedding, pre-computed tokens capability
  - `Rerank Model` - Segment Rerank capability
  - `Speech-to-text Model` - Speech to text capability
  - `Text-to-speech Model` - Text to speech capability
  - `Moderation` - Moderation capability

- Provider and model metadata

  [ModelProviderFactory](model_providers/model_provider_factory.py) exposes provider
  schemas, model lists, icons, and credential validation through an injected
  runtime. [Entity definitions](entities/) describe model parameters and credential
  form rules that host applications can use.

- Provider/model credential authentication

  The provider list returns configuration information for the credentials form, which can be authenticated through Runtime's interface.

## Structure

Model Runtime is divided into protocol and implementation layers:

- Provider/runtime protocols

  Shared provider concerns live in `protocols/provider_runtime.py`, while each
  model capability has its own protocol module such as
  `protocols/llm_runtime.py`, `protocols/text_embedding_runtime.py`, and
  `protocols/tts_runtime.py`. Downstream runtimes can implement only the
  capabilities they need instead of satisfying a single monolithic interface.

- Aggregate runtime protocol

  `protocols/runtime.py` composes the individual capability protocols into
  `ModelRuntime` for adapters that intentionally implement the full surface
  area.

- Provider factory

  `model_providers/model_provider_factory.py` now depends only on
  `ModelProviderRuntime`. It handles provider discovery, provider/model schema
  lookup, credential validation, provider icon lookup, and provider-level model
  list projection without assuming any invocation capability.

- Model wrappers

  Capability wrappers such as `LargeLanguageModel`, `TextEmbeddingModel`,
  `RerankModel`, `Speech2TextModel`, `ModerationModel`, and `TTSModel` depend
  only on their matching capability protocol. Instantiate those wrappers
  directly when you need invocation behavior.

## Documentation

Follow [model dispatch tests](../../../tests/model_runtime/test_model_dispatch.py)
for capability-specific adapters and the
[development guide](../../../docs/development.md) for host integration points.
