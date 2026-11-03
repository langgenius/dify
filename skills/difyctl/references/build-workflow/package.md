# App package

## Contents

- The folder
- What you write and what fill writes
- Where things go
- Tool node
- Agent node
- Iteration and loop
- Canvas notes
- The check

## The folder

A package is the app as a folder. Start from an export of the draft, unzipped into `app/`.

- `app.yaml` is the app. You edit only this file.
- `manifest.yaml` lists the members with their size and sha256. Fill keeps it in step with `app.yaml`.
- Other members, such as Agent and skill files, belong to the app. Leave them as they are.

A new Workflow app's graph is empty. A new Chatflow's is `start` → `llm` (no model yet, which check reports) → `answer` (`{{#llm.text#}}`). Keep the export's `version`, `kind`, `features`, `environment_variables` and `conversation_variables`.

## What you write and what fill writes

`<app_mode>` below is the `app.mode` value. You write:

- each node as `{id, data}`. `data` starts as the option's `seed` from `difyctl get node_option`, which holds the canvas's settings for a new node. Set `title`, and write every field the plan decides. Leave the seed's settings as they are unless the plan changes them. Leave out the wrapper fields (`type: custom`, `position` and the rest).
- each edge as `{source, target}`, plus `sourceHandle` when the source is a branch node.
- each canvas note, as the note section says.

Fill writes what is missing, and keeps every value you wrote except the layout:

- the editor's wrapper fields on each top-level node;
- a new layout of every top-level node, each time, as the canvas's Organize button does: left to right, with each branch's targets in the order of its handles. Never write or keep positions; they are replaced;
- `title` set to the node type, when you left it out;
- each canvas setting for the node's type that you left out, such as HTTP request retries, and the empty lists the canvas starts with. It never writes an empty value into a field the node requires;
- each tool's declared defaults;
- each edge's `id`, `targetHandle`, and `sourceHandle: source` when the source is not a branch node. It never picks a branch handle;
- each note's editor text, and a size and position that frame the nodes it covers;
- the manifest's size and sha256 for `app.yaml`.

Fill writes the canvas's settings, never a choice. A required field you haven't written stays out, and check reports it as `node_data_invalid`. Some fields whose value is often empty are required too: write HTTP `headers` and `params` (`""` for none), Code `outputs`, human-input `debug_mode.channels`, and an LLM's prompt. The seed's prompt is a chat list; for a model in `completion` mode, write `prompt_template` as one `{text}` object instead. Filling a filled package changes nothing.

## Where things go

- `app.mode` is `workflow` for a Workflow app and `advanced-chat` for a Chatflow app.
- Nodes go in `workflow.graph.nodes[]`, edges in `workflow.graph.edges[]`.
- A node id is any unique string. Never change the id of an existing node.
- `sourceHandle` on a branch node:
  - if-else: each case's `case_id`, plus `false` for else;
  - question classifier: each class's `id`;
  - human input: each `user_actions` id, plus `__timeout`;
  - Agent with `agent_output_routes.enabled: true`: each route's `id`;
  - `error_strategy: fail-branch` adds a `fail-branch` handle for failure. Success still leaves by the node's usual handles: `source`, or the branch handles above.
- Give every branch an edge, including `false` and `__timeout`.
- End node output names must be unique across all End nodes.
- Read another node's output as `{{#<node_id>.<var>#}}` in text, and `[<node_id>, <var>]` in a `value_selector`.
- An LLM node's `model` is the `node_model` of a row from `difyctl get model --model-type llm`, as the plan names it. Set `reasoning_format: separated` on every LLM node: it moves a model's `<think>` text out of `text`, and changes nothing for a model that writes none. You can't tell from the model list which models think.
- A knowledge-retrieval node is the block seed plus a row's `node_data` from `difyctl get knowledge_base`.
- Never put secret values in `app.yaml`.
- Don't use `datasource` or `knowledge-index` nodes. They belong to knowledge pipelines.
- A schedule trigger runs on its top-level `frequency`, `visual_config` and `timezone` (an IANA name such as `Asia/Shanghai`). `visual_config.time` reads like `8:00 AM`. An export also adds a `config` block of defaults; nothing reads it, so leave it as it is.

## Tool node

- Start from the seed of the tool's row in `difyctl get node_option --app-mode <app_mode> --kind tool`. Keep `tool_node_version: "2"`.
- Fill writes each parameter's declared default. Write the plan's value for every other parameter.
- Every value is `{type, value}`: `{type: constant, value: …}`, `{type: mixed, value: "{{#node_id.var#}}"}`, or `{type: variable, value: [node_id, var]}`.
- A parameter whose `form` is `llm` goes in `tool_parameters`; any other goes in `tool_configurations`. Check's `plugin_parameters` lists each one with its `form`.
- Leave out `credential_id`; the workspace's default credential is used.
- A tool node's outputs are `text`, `files` and `json`, plus any the tool declares.

## Agent node

- Start from the seed of the Agent's row in `difyctl get node_option --app-mode <app_mode> --kind agent`. Its `agent_binding` links the roster Agent; keep it as it is.
- Write `agent_task` and the other fields from the plan. Check's `open_fields` lists what is left.

## Iteration and loop

Fill doesn't create a container's start child, and doesn't add wrapper fields to nodes inside a container. Write them by hand. For an iteration with id `<it>`:

- the iteration's `data.start_node_id` is `<it>start`;
- the start child is `{id: <it>start, type: custom-iteration-start, parentId: <it>, position: {x: 24, y: 68}, draggable: false, selectable: false, zIndex: 1002, data: {type: iteration-start, title: "", isInIteration: true}}`;
- each node inside is `{id, type: custom, parentId: <it>, position, zIndex: 1002, data}`. `position` is relative to the iteration, starting at `{x: 128, y: 68}`. `data` adds `isInIteration: true` and `iteration_id: <it>`;
- an edge runs from `<it>start` to the first node inside.

A loop is the same with `custom-loop-start`, `loop-start`, `isInLoop: true` and `loop_id`.

## Canvas notes

Write a note only when `plan.md` has a Notes table. Start from the seed of `difyctl get node_option --app-mode <app_mode> --kind note`. The seed is a whole node, not `data`. Then add:

- `id`;
- `data.text`: plain text, one paragraph per line;
- `data.theme`: one of `blue`, `cyan`, `green`, `yellow`, `pink`, `violet`;
- `data.author`: the name in `plan.md`;
- `data.covers`: the ids of the top-level nodes the note explains.

Fill turns the text into the editor's format, and frames the note under the nodes it covers each time it runs. To change what a note frames, change its `covers`. Never connect an edge to a note. An exported note's `text` is already in the editor's format: leave it as it is, or replace it with plain text to change the words.

## The check

`difyctl check console_app package` fills the package first, then checks the result. It runs every check `check console_app dsl` runs, and the package's own. The result:

- `valid`: true when no issue is an `error`. Warnings don't change it.
- `issues[]`: `code`, `severity`, `refuses_import`, `message`, `node_id`, `loc` (the field) and `hint` (for a field: its type, options, description and, for a list of objects, the item's fields as `items`). `refuses_import` marks what the import refuses today; import only when `valid` is true anyway.
- `node_specs[]`, per node: `schema` (the data's JSON schema), `plugin_parameters` (the tool's declared parameters) and `open_fields` (every field not written yet, required first).

Errors. Fix each by its `loc`:

- `node_data_invalid`: a field is wrong, or required and not written yet. Write the plan's value; the hint gives its type, options and description, and for a list of objects, `items` lists each item's fields.
- `graph_invalid`, `unknown_node_type`, `edge_endpoint_missing`, `reference_missing`: the graph names something that isn't there.
- `mode_incompatible`: the mode can't hold that node type, such as End in a Chatflow or Answer in a Workflow.
- `branch_handle_invalid`: the message lists the handles to use.
- `container_start_missing`: write the start child as above.
- `output_name_duplicate`: rename the End output.
- `no_root_node`: add the Start node, or a trigger in a Workflow.
- `plugin_not_found`: the workspace lacks the tool. Look up its row again; if it's gone, report it as `plugins.md` says.
- `plugin_parameter_missing`: write the value at `loc` as `{type, value}`.
- `manifest_stale`, `manifest_missing`: `app.yaml` changed after the last fill. Fill again and unzip.
- `note_text_invalid`: write `text` as plain text.
- `note_field_missing`: write the `theme`, `author` or `showAuthor` the message names.
- `note_cover_unknown`: `covers` names something that isn't a top-level node.

Warnings. Fix each, or report it to the human:

- `resource_unavailable`: a model, tool or plugin the workspace lacks. Runs fail on it, and so does the release check.
- `branch_unconnected`: a branch with no edge. A run that takes it stops there, and the release check fails.
- `note_too_small`: the note is below the canvas minimum of 240×88.
- `reference_empty`: a variable selector is `[]`. Write the plan's selector, or remove the unused variable. The release check fails on it.

Check doesn't compare variable names with node outputs, value types with declared types, or model parameters. Test runs find those.
