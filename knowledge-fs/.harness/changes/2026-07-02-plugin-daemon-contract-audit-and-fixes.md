# Plugin-daemon contract audit against dify (field-by-field) + conformance fixes

Date: 2026-07-02

## Context

Requested audit: confirm that EVERY model call in knowledge-fs follows Dify's plugin-daemon calling
convention exactly. The authority used is the local dify checkout
(`/Users/jyong/workspace/dify`): `api/core/plugin/impl/base.py` (transport),
`api/core/plugin/impl/model.py` (`invoke_llm` / `invoke_text_embedding` / `invoke_rerank` payloads,
`_dispatch_payload` envelope), and the model-runtime entities recovered from git history at
`4fd6b52808~1` (the commit that moved them into the external `graphon` package — the wire shapes are
unchanged by that move): `text_embedding_entities.py`, `rerank_entities.py`, `llm_entities.py`,
`message_entities.py`, plus `core/entities/embedding_type.py` (`EmbeddingInputType`).

## Verified compliant (no change needed)

- Transport: URL `POST {PLUGIN_DAEMON_URL}/plugin/{tenant_id}/dispatch/{op}/invoke`; headers
  `X-Api-Key`, `X-Plugin-ID`, `Content-Type: application/json`; body `{data, user_id?}` with
  `user_id` omitted when absent (dify `_dispatch_payload` does the same); envelope
  `{code, message, data}`; `code != 0` error unwrap including nested `PluginInvokeError`
  (`_handle_plugin_daemon_error` semantics).
- `rerank` op: `{provider, model_type:"rerank", model, credentials, query, docs, score_threshold?,
  top_n?}`; response `RerankResult {model, docs:[{index, text, score}]}` matched by index.
- `llm` op: `{provider, model_type:"llm", model, credentials, prompt_messages, model_parameters,
  stream:true}`; roles are lowercase (`system|user|assistant` = dify `PromptMessageRole`); stream
  chunks parsed as `LLMResultChunk {model, delta:{message:{content}, usage?, finish_reason?}}`;
  LLM `usage.prompt_tokens/completion_tokens/total_tokens` matches dify `LLMUsage`. Both the
  generation adapter and `pluginDaemonLlmCompletion` conform. (`tools`/`stop` omitted vs dify's
  explicit `null` — equivalent for the plugin SDK's optional fields.)
- Credentials default `{}` (daemon-resolved), per-request real tenant in the URL path.
- Call-site inventory: exactly four dispatch sites (embeddings text_embedding, embeddings rerank,
  generation llm, apps/api llm completion). No vendor HTTP endpoints anywhere. The only non-daemon
  model call is the image-byte visual embedding (`KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER=http`), the
  documented Phase-5 exception.

## Deviations found and FIXED

1. **`text_embedding.input_type` case** (`packages/embeddings`): sent `"QUERY"/"DOCUMENT"`; dify's
   `EmbeddingInputType` is a lowercase StrEnum and `jsonable_encoder` puts `"query"/"document"` on
   the wire. → now lowercase.
2. **Embedding response usage** (`packages/embeddings`): schema expected `usage.prompt_tokens`,
   but dify's `EmbeddingUsage` carries `tokens`/`total_tokens` (plus price fields). Usage was
   silently dropped. → schema now `{tokens?, total_tokens?}`, mapped to
   `totalTokens = total_tokens ?? tokens`.
3. **Multimodal content parts — the previously flagged UNVERIFIED assumption is now verified WRONG**
   (`apps/api/multimodal-answer-options.ts` + `multimodal-enrichment-options.ts`): we sent
   OpenAI-style `{type:"text",text}` / `{type:"image_url",image_url:{url,detail}}`. Dify's
   `PromptMessageContentUnionTypes` (discriminated on `type`) is:
   - text: `{type:"text", data: string}`
   - image: `{type:"image", format, base64_data|url, mime_type, filename?, detail:"low"|"high"}`
   The old shape would fail the plugin SDK's discriminator validation outright (`image_url` is not a
   valid type; text parts lack `data`) — multimodal calls could not have worked. → both builders now
   emit dify parts; data URLs are decomposed into `base64_data`/`mime_type`/`format`; `detail:"auto"`
   (kept in our env surface) maps to `"low"`, dify's default.
4. **Transport line semantics** (`packages/plugin-daemon-client`): dify treats EVERY non-empty
   response line as one envelope, with an optional `data:` prefix stripped — it does NOT do SSE
   multi-line `data:` accumulation. Our parser only recognized `data:`-prefixed field lines and
   would silently drop bare JSON lines. → parser rewritten to dify's exact line semantics (per-line,
   optional prefix strip; cross-chunk line buffering kept).
5. **Empty success data** (`packages/plugin-daemon-client`): dify raises on `code==0` with empty
   `data`; we silently yielded `undefined`. → now throws `plugin_daemon_response_invalid`.

Tests updated alongside each fix (`plugin-daemon-embedding.test.ts`, both multimodal options tests,
`plugin-daemon-client/index.test.ts`: bare-line + split-line + empty-data cases replace the
multi-line-data test, which asserted non-dify behavior).

## Notes / follow-ups

- Current dify also exposes `multimodal_embedding/invoke` (`model_type:"text-embedding"`,
  `documents: list[dict]`) — a future path to move the image-byte visual embedding off the HTTP
  exception onto the daemon. Not done here.
- LLM response `message.content` can be `str | list` in dify entities; our schema accepts `str`
  (a non-string content chunk is skipped). Daemon LLM text responses are strings in practice.
- Entity shapes were verified against dify git commit `4fd6b52808~1`; `graphon==0.5.1` (the pinned
  external package) is not vendored locally. If the deployed dify diverges from this, re-verify.

## Verification

- Field-by-field comparison documented above; repo-wide grep confirms no other dispatch sites, no
  vendor endpoints, and no stale test assertions (`QUERY`, `prompt_tokens` usage, `image_url` parts).
- No Node runtime here — run `pnpm check` (plugin-daemon-client, embeddings, api-app suites cover
  every fixed path).
