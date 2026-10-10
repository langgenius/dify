# Plugins, models and credentials

## Find tools, models and knowledge bases

1. `difyctl get tool --query <service>` lists tools the workspace can use: built-in and plugin tools, workflows published as tools, API tools and MCP tools. Each row has `configured` and a ready `node_data`.
2. `difyctl get model --model-type llm` lists models across providers (`--provider <id>` for one). Use one whose `status` is `active`. Paste the row's `node_model` as the LLM node's `model` block; don't build it by hand.
3. For knowledge bases: `difyctl get knowledge_base --query <words>`. A knowledge-retrieval node needs a row's `node_data`.
4. Nothing fits: `difyctl get marketplace plugin --query <service> --category tool` (or `--category model`).
5. When building an app, rank the options by the tool rule in [build-workflow.md](build-workflow.md).

## Missing plugins after an import

1. `difyctl check console_app dependency --app-id <app_id>` lists what the app needs and lacks. Its hint is a ready `install.plugin` call with every missing marketplace plugin.
2. Plugins from GitHub or a package file can't be installed with difyctl. Tell the human to install them in the console.

## Find and install

1. `difyctl get marketplace plugin --query <words>` searches the marketplace. Each hit has `identifier` (the versioned id to install) and `installed`.
2. Confirm with the human before installing. Then `difyctl install plugin --identifiers <identifier>`.
3. Install finishes in the background. Run the `describe.plugin.task` hint until `status` is `success` or `failed`. On `failed`, show the human each plugin's `message`. If `all_installed` is true there is no task; follow the provider hint.
4. On success the hint names the provider to set up: `describe.model_provider` or `describe.tool_provider`.

`get.plugin` lists installed plugins; `provides` gives their provider ids.

## Credentials

1. `difyctl describe model_provider --provider <id>` (or `describe tool_provider`) shows `credential_form` and the saved `credentials` (names only).
2. Ask the human for each form value. Never invent one, never print it, never write it into the working folder.
3. Pass the values on stdin: `difyctl create model_provider credential --provider <id> --credentials @-` (for tools, `difyctl create tool_provider credential --provider <id> --credentials @-`), then write the JSON object to stdin.
4. A 422 means the provider rejected the values; nothing was saved. Show the human the message and ask again.
5. If another credential is already active, the hint offers to replace its values with `set`.
6. A tool provider whose `credential_types` lacks `api-key` uses OAuth. Ask the human to authorize it in the console.

Self-hosted or OpenAI-compatible models: `create model credential` with `--model`, `--model-type` and `--credentials @-`.

## Remove

Only when the human asks: `delete.plugin`. Removing a plugin breaks apps that use it; say so first. Uninstalling also deletes the plugin's saved credentials.
