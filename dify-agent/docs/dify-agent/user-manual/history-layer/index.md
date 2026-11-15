# History module

`dify_agent.layers.history` declares Config, State and Capability. Config is
empty. State contains `messages`, encoded as JSON using Pydantic AI message
schemas. The runner explicitly loads initial message_history and writes the
captured history on every terminal outcome, preserving compaction and partial
responses. Current instructions are removed and unmatched trailing calls are
marked interrupted on failure or cancellation. The reserved name is `history`.
