# App DSL

Start from an export of the app's draft: a new app's export is a valid empty skeleton. Keep its `version`, `kind`, `features`, `environment_variables` and `conversation_variables`.

## Where things go

- `app.mode` is `workflow` for a Workflow app and `advanced-chat` for a Chatflow app.
- `workflow.graph.nodes[]`: `{id, type: custom, data: {type, title, version, ...}, position: {x, y}}`. The rest of `data`, and `version`, come from `difyctl describe node_type --node-type <type>`.
- `workflow.graph.edges[]`: `{id, source, target, sourceHandle, targetHandle: target}`. `sourceHandle` is `source`, except on branch nodes:
  - if-else: each case's `case_id`, plus `false` for else;
  - question classifier: each class's `id`;
  - human input: each `user_actions` id, plus `__timeout`;
  - `error_strategy: fail-branch`: `source` for success, `fail-branch` for failure.
- Give every branch an edge, including `false` and `__timeout`.
- End node output names must be unique across all End nodes.
- A node id is any unique string. Never change the id of an existing node.
- Read another node's output as `{{#<node_id>.<var>#}}` in text, and `[<node_id>, <var>]` in a `value_selector`.
- An LLM node's `model` is the `node_model` of a row from `difyctl get model --model-type llm`, as the plan names it.
- A knowledge-retrieval node starts from a row's `node_data` in `difyctl get knowledge_base`.
- Never put secret values in the DSL.
- Don't use `datasource` or `knowledge-index` nodes. They belong to knowledge pipelines.
- An import over an existing app copies the YAML's `app.name`, description and icon onto the app.
- Import fills empty containers, such as Start `variables` and tool parameter maps. It never fills in a model, classes or a prompt.

## Tool node

- Start from the tool's `node_data` in `difyctl get tool`. Put it in the node's `data` as it is.
- Keep `tool_node_version: "2"`. Every value in `tool_parameters` and `tool_configurations` stays `{type, value}`.
- Fill every `null` value: `{type: constant, value: …}`, `{type: mixed, value: "{{#node_id.var#}}"}`, or `{type: variable, value: [node_id, var]}`.
- Leave out `credential_id`; the workspace's default credential is used.

## The check

`difyctl check console_app dsl` and the import run the same check. Each issue has a `code`, a `severity`, a `node_id`, a `loc` that points to the field, and a `message`.

- An `error` stops the import. Fix it by its `loc`.
- A `warning` does not stop the import, but the release check fails on it. Fix it, or report it to the human:
  - `resource_unavailable`: a model, tool or plugin the workspace lacks. Runs fail on it.
  - `branch_unconnected`: a branch with no edge. A run that takes it stops there.
