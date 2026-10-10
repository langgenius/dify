# Execution context module

`dify_agent.layers.execution_context.layer` declares Config, empty State and
Capability. Config carries tenant/user/app/invoke identity and correlation IDs.
Other modules refer to its registered name in their Config. Server-only daemon
settings and clients are borrowed from Deps.services. Knowledge retrieval
requires its complete caller identity before any external request.
