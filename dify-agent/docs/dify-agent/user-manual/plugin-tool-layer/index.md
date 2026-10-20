# Plugin tool module

`dify_agent.layers.dify_plugin.tools_layer` declares Config, State and native
Toolset. The `tools` registry name accepts API-prepared declarations, parameters,
runtime values and model-facing schema, plus `execution_context` and optional
`shell` Config references. Hidden/default parameter merging, loose schemas and
observation mapping preserve the API-prepared contract. Sandbox paths use the
referenced live shell session to upload files; file mappings resolve signed URLs
through the borrowed Dify API client. Config and credentials are never snapshotted.
