# Structured output module

`dify_agent.layers.output.output_layer` declares Config, empty State and
Capability. The reserved `output` name accepts a top-level object JSON Schema,
optional description and strictness. The runner resolves native output_type
before running the agent. A fresh dynamic type exposes the schema and performs
JSON Schema validation in Pydantic AI's retry pipeline. The model-facing tool
name is final_output. Local `#/$defs/` references are supported, including
JSON Pointer escapes such as `~0` and `~1`; remote or recursive references are
rejected before I/O. Resume resubmits current Config.
