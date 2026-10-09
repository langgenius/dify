# Plugins, models and credentials

Read this in the spec phase to find tools and models, and whenever a plugin, model, tool or credential is missing, or the user asks to install, upgrade or remove a plugin.

## Find tools and models

1. `difyctl get tool --query <service>` lists tools the workspace can use: built-in and plugin tools, workflows published as tools, API tools and MCP tools. Each row has `configured` and a ready `node_data`.
2. `difyctl get model --model-type llm` lists models across providers. Use one whose `status` is `active`.
3. Nothing fits: `difyctl get marketplace plugin --query <service> --category tool` (or `--category model`).
4. Show the human the options and let them pick. Never install or choose for them.

## Missing plugins after an import

1. `difyctl check console_app dependency --app-id <app_id>` lists what the app needs and lacks. Its hint is a ready `install.plugin` call with every missing marketplace plugin.
2. Plugins from GitHub or a package file can't be installed with difyctl. Tell the user to install them in the console.

## Find and install

1. `difyctl get marketplace plugin --query <words>` searches the marketplace. Each hit has `identifier` (the versioned id to install) and `installed`.
2. Confirm with the user before installing. Then `difyctl install plugin --identifiers <identifier>`.
3. Install finishes in the background. Run the `describe.plugin.task` hint until `status` is `success` or `failed`. On `failed`, show the user each plugin's `message`. If `all_installed` is true there is no task; follow the provider hint.
4. On success the hint names the provider to set up: `describe.model_provider` or `describe.tool_provider`.

`get.plugin` lists installed plugins; `provides` gives their provider ids.

## Credentials

1. `difyctl describe model_provider --provider <id>` (or `describe tool_provider`) shows `credential_form` and the saved `credentials` (names only).
2. Ask the user for each form value. Never invent one, never print it, never write it into the working folder.
3. Pass the values on stdin: `difyctl create model_provider credential --provider <id> --credentials @-` (for tools, `difyctl create tool_provider credential --provider <id> --credentials @-`), then write the JSON object to stdin.
4. A 422 means the provider rejected the values; nothing was saved. Show the user the message and ask again.
5. If another credential is already active, the hint offers to replace its values with `set`.
6. A tool provider whose `credential_types` lacks `api-key` uses OAuth. Ask the user to authorize it in the console.

## Models

- `difyctl get model --provider <id>` lists one provider's models; use one whose `status` is `active`.
- Self-hosted or OpenAI-compatible models: `create model credential` with `--model`, `--model-type` and `--credentials @-`.
- `get.default_model` and `set.default_model` read and set the workspace defaults. Change a default only when the user asks.

## Upgrade and remove

Only when the user asks: `upgrade.plugin` (with the new `identifier`), `delete.plugin`. Removing a plugin breaks apps that use it; say so first. Uninstalling also deletes the plugin's saved credentials.
