# Plugin tool module

`dify_agent.layers.dify_plugin.tools_layer` declares Config, State and native
Toolset. The `tools` registry name accepts API-prepared declarations, parameters,
runtime values and model-facing schema, plus `execution_context` and optional
`shell` Config references. Hidden/default parameter merging, loose schemas and
observation mapping preserve the API-prepared contract. Sandbox paths use the
referenced live shell session to upload files; file mappings resolve signed URLs
through the borrowed Dify API client. Config and credentials are never snapshotted.

Media output is a lightweight file-handle summary. Blob outputs are uploaded as
ToolFiles using the current caller identity; upload failures produce text hints
without blob data. `DIFY_AGENT_STUB_UPLOAD_FILE_SIZE_LIMIT` limits both Agent Stub
uploads and plugin `BLOB` persistence (default: 50 MiB). Oversized blobs produce
a text hint before requesting an upload URL. The model can call `read_media(file=<summary object>)` when
it needs to inspect content. File inputs supplied as workspace paths use
`dify-agent file upload --no-download-link` through the shell session.

Each prepared tool includes `plugin_unique_identifier` (version and checksum)
alongside `plugin_id`. The daemon receives it as `X-Plugin-Unique-Identifier`
and executes that exact plugin package, even if the installed version changes
during the run. Tool clients are shared only within the same complete identifier.
Older configurations can omit the identifier and retain plugin-ID dispatch.
