# History module

`dify_agent.layers.history` declares Config, State and Capability. Config is
empty. State contains `messages`, encoded as JSON using Pydantic AI message
schemas. The runner explicitly loads initial message_history and writes the
captured history on every terminal outcome, preserving compaction and partial
responses. Current instructions are removed and unmatched trailing calls are
marked interrupted on failure or cancellation. The reserved name is `history`.

Dify model responses retain their original content blocks and provider state in
`ModelResponse.provider_details["dify_message"]` so tool rounds and restored runs
can replay signed or encrypted content without rebuilding it from display text.
Replay metadata is reused only when both the provider and model match the saved response.
Older history without this field continues to use its native message parts.
