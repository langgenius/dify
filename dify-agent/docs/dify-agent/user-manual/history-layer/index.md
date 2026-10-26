# History module

`dify_agent.layers.history` declares Config, State and Capability. Config is
empty. State contains `messages`, encoded as JSON using Pydantic AI message
schemas. The runner explicitly loads initial message_history and writes the
captured history on every terminal outcome, preserving compaction and partial
responses. Current instructions are removed. Interruption during tool
execution preserves a trailing interrupted `ModelRequest`; cancellation before
tool processing begins may instead leave a complete tool-call `ModelResponse`,
which is marked interrupted here so a fresh prompt can resume without
executing abandoned calls. The reserved name is `history`.
