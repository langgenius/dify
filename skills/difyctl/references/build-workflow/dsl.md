# App DSL

## Contents

- Where things go
- What import refuses
- Tool node
- Minimal Workflow
- Minimal Chatflow

This is the shape of an exported draft. Values vary. Both examples below are trimmed from real fixtures in the Dify repo.

## Where things go

- Top level: `version`, `kind: app`, `app` (name, mode, icon), `dependencies`, `workflow`.
- Keep the `version` your export gave you. The examples below show an older one.
- `app.mode` is `workflow` for a Workflow app and `advanced-chat` for a Chatflow app.
- `workflow.graph.nodes[]`: `{id, type: custom, data: {type, title, ...}, position: {x, y}}`. `data.type` is the node type. The rest of `data` comes from `difyctl describe node_type --node-type <type>`.
- Set each node's `data.version` to the `version` that `describe node_type` returns. The trimmed examples below leave `data.version` out; always add it.
- `workflow.graph.edges[]`: `{id, source, target, sourceHandle: source, targetHandle: target, data: {sourceType, targetType}}`.
- Branch nodes use another `sourceHandle`:
  - if-else: each case's `case_id` (the first case is usually `true`), plus `false` for the else branch;
  - question classifier: each class's `id`;
  - a node with `error_strategy: fail-branch`: `source` for success, `fail-branch` for failure.
- `workflow.features`, `workflow.environment_variables`, `workflow.conversation_variables`: keep what the export gave you.
- A node id is any unique string. Never change the id of an existing node.
- Read another node's output as `{{#<node_id>.<var>#}}` in text fields. In `value_selector` write `[<node_id>, <var>]`.
- An LLM node's `model.provider` and `model.name` must name a model set up in the workspace. Use the one the plan names. If the plan names none, ask the human.
- Never put secret values in the DSL.
- An import over an existing app copies the YAML's `app.name`, description and icon onto the app.

## What import refuses

- No `answer` node in a Workflow app.
- No `end` node and no trigger nodes in a Chatflow app.
- Don't use `datasource` or `knowledge-index`. They belong to knowledge pipelines.

## Tool node

- Start from the tool's `node_data` in `difyctl get tool`. Put it in the node's `data` as it is.
- Keep `tool_node_version: "2"`. Every value in `tool_parameters` and `tool_configurations` stays `{type, value}`.
- Fill every `null` value. A constant is `{type: constant, value: …}`. Text with references is `{type: mixed, value: "{{#node_id.var#}}"}`. A single variable is `{type: variable, value: [node_id, var]}`.
- Leave out `credential_id`; the workspace's default credential is used.

## Minimal Workflow

Start wired to End. Source: `api/tests/fixtures/workflow/simple_passthrough_workflow.yml`, a real console export, trimmed.

```yaml
version: 0.3.1
kind: app
app:
  name: echo
  mode: workflow
  icon: 🤖
  icon_background: '#FFEAD5'
  description: ''
  use_icon_as_answer_icon: false
dependencies: []
workflow:
  conversation_variables: []
  environment_variables: []
  features:
    file_upload: { enabled: false }
    opening_statement: ''
    retriever_resource: { enabled: true }
    sensitive_word_avoidance: { enabled: false }
    speech_to_text: { enabled: false }
    suggested_questions: []
    suggested_questions_after_answer: { enabled: false }
    text_to_speech: { enabled: false, language: '', voice: '' }
  graph:
    nodes:
      - id: '1754154032319'
        type: custom
        position: { x: 30, y: 227 }
        data:
          type: start
          title: Start
          desc: ''
          variables:
            - {
                variable: query,
                label: query,
                type: text-input,
                required: true,
                max_length: null,
                options: [],
              }
      - id: '1754154034161'
        type: custom
        position: { x: 334, y: 227 }
        data:
          type: end
          title: End
          desc: ''
          outputs:
            - { variable: query, value_type: string, value_selector: ['1754154032319', query] }
    edges:
      - id: 1754154032319-source-1754154034161-target
        type: custom
        source: '1754154032319'
        sourceHandle: source
        target: '1754154034161'
        targetHandle: target
        data: { sourceType: start, targetType: end }
```

## Minimal Chatflow

Start, then an LLM, then Answer. Source: `api/tests/fixtures/workflow/basic_chatflow.yml`, trimmed. The fixture leaves the model empty; fill in `provider` and `name`.

```yaml
version: 0.3.1
kind: app
app:
  name: basic_chatflow
  mode: advanced-chat
  icon: 🤖
  icon_background: '#FFEAD5'
  description: Simple chatflow contains only 1 LLM node.
  use_icon_as_answer_icon: false
dependencies: []
workflow:
  conversation_variables: []
  environment_variables: []
  features:
    file_upload: {}
    opening_statement: ''
    retriever_resource: { enabled: true }
    sensitive_word_avoidance: { enabled: false }
    speech_to_text: { enabled: false }
    suggested_questions: []
    suggested_questions_after_answer: { enabled: false }
    text_to_speech: { enabled: false, language: '', voice: '' }
  graph:
    nodes:
      - id: '1755189262236'
        type: custom
        position: { x: 80, y: 282 }
        data:
          type: start
          title: Start
          desc: ''
          variables: []
      - id: llm
        type: custom
        position: { x: 380, y: 282 }
        data:
          type: llm
          title: LLM
          desc: ''
          context: { enabled: false, variable_selector: [] }
          memory:
            query_prompt_template: '{{#sys.query#}}'
            window: { enabled: false, size: 10 }
          model:
            provider: ''
            name: ''
            mode: chat
            completion_params: { temperature: 0.7 }
          prompt_template:
            - { role: system, text: '' }
          variables: []
          vision: { enabled: false }
      - id: answer
        type: custom
        position: { x: 680, y: 282 }
        data:
          type: answer
          title: Answer
          desc: ''
          answer: '{{#llm.text#}}'
          variables: []
    edges:
      - id: 1755189262236-llm
        source: '1755189262236'
        sourceHandle: source
        target: llm
        targetHandle: target
      - id: llm-answer
        source: llm
        sourceHandle: source
        target: answer
        targetHandle: target
```
