# Prompt module

`dify_agent.layers.prompt` declares Config, State and native Toolset. Config
accepts `prefix`, `suffix` and `user` string fragments or lists. Prefix/suffix
become dynamic instructions; `user` contributes current user content. State is
empty. Instruction order is unspecified. Product names `agent_soul_prompt`,
`workflow_node_job_prompt`, and `workflow_user_prompt` map to this module.
