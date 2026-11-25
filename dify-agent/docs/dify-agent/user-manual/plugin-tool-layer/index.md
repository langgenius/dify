# Plugin tool module

`dify_agent.layers.dify_plugin.tools_layer` declares Config, State and native
Toolset. The `tools` registry name accepts API-prepared declarations, parameters,
runtime values and model-facing schema, plus `execution_context` and optional
`shell` Config references. Hidden/default parameter merging, loose schemas and
observation mapping preserve the API-prepared contract. Sandbox paths use the
referenced live shell session to upload files; file mappings resolve signed URLs
through the borrowed Dify API client. Config and credentials are never snapshotted.

Media output is a lightweight file-handle summary produced by
`format_media_observation`. Blob outputs are uploaded as ToolFiles using the
shared `agent_files.upload_agent_tool_file` control plane and the current caller
identity. It allocates a signed `/files/upload/for-plugin?...` URI before sending
the bytes. Upload failures produce `Tool media unavailable` text hints without
blob data. `DIFY_AGENT_STUB_UPLOAD_FILE_SIZE_LIMIT` limits both Agent Stub
uploads and plugin `BLOB` / `BLOB_CHUNK` persistence (default: 50 MiB). Oversized
blobs and chunks produce a single `Tool media unavailable` text hint per failed
file before requesting an upload URL; chunk streams are also validated for
ordered sequence numbers, consistent declared length, and complete final byte
count, and chunk failures are isolated per chunk file so truncated files are
never uploaded while sibling text and valid attachments from the same tool
invocation are still preserved. In `agent_app` mode, successfully persisted blob
observations tell the model that the file has already been delivered to the user
as an attachment while keeping the copyable handle for
`read_media(file=<summary object>)` when content inspection is needed. File
inputs supplied as workspace paths use `dify-agent file upload --no-download-link`
through the shell session.

`BLOB_CHUNK` messages preserve and merge metadata across chunks into the final
`BLOB`, including when the closing chunk omits metadata. Before upload, blob
filenames are reduced to safe basenames (missing names default to
`<tool_name>_output_<index><ext>` in stream order), known media MIME aliases
(such as `application/x-pdf`, `image/jpg`, and `audio/wave`) are normalized to
canonical media MIME types, missing or generic `application/octet-stream` MIME
types are inferred from known extensions when possible, and missing or
conflicting extensions are repaired without overwriting equivalent safe
extensions or safe unknown extensions. Successful blob outputs return a native
`ToolReturn` with `metadata["dify_plugin_blob_files"]` containing the persisted
ToolFile IDs in stream order. The API validates their ownership and delivers
assistant attachments in chat and Agent Logs. These IDs are attachment
candidates, not authorization tokens. Other media messages provide handles for
`read_media` without adding attachment IDs. Tools without successfully uploaded
blobs return plain text.

Each prepared tool includes `plugin_unique_identifier` (version and checksum)
alongside `plugin_id`. The daemon receives it as `X-Plugin-Unique-Identifier`
and executes that exact plugin package, even if the installed version changes
during the run. Tool clients are shared only within the same complete identifier.
Older configurations can omit the identifier and retain plugin-ID dispatch.
