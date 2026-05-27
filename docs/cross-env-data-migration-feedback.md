# Cross-Environment Data Migration Feedback

## Context

This branch adds CLI support for exporting and importing custom API tools, workflow apps, workflow tools, and MCP tools across Dify environments.

The current implementation works as a migration script, but several behaviors are too environment-specific for a reusable product feature.

## Feedback

### Separate Source And Target Tenant Semantics

The current `tenant_name` field has multiple meanings:

- It is used during export to locate source workspace resources.
- It is written into the export JSON and later used during import to locate the target workspace.
- It falls back to `INIT_WORKSPACE_NAME` when omitted.

This assumes source and target workspaces have the same tenant name. That is convenient for one controlled enterprise setup, but too rigid for general use.

Preferred direction:

- The export package should record source tenant information only as metadata.
- The import command should accept the target tenant explicitly, for example `--target-tenant`.
- Import should not require source and target tenant names to match.

Example:

```bash
flask export-custom-data --input export-config.json --output migration-package.json
flask import-custom-data --input migration-package.json --target-tenant prod-workspace
```

### Make Workflow Export Tenant-Scoped

When `export_all_workflows=true`, the current implementation exports all workflow and advanced-chat apps without filtering by tenant.

This should be tenant-scoped. Otherwise, a multi-tenant deployment can export unrelated tenants' workflows and label them with a single `tenant_name`.

### Add Explicit Secret Export Policy

The current export behavior includes sensitive data by default:

- API tool credentials are decrypted when exported.
- Workflow DSL is exported with `include_secret=True`.
- MCP server URL and headers are decrypted.

For a general feature, secrets should not be exported by default. Prefer an explicit option such as `--include-secrets`, with warning output when enabled.

### Add Conflict And ID Strategies

The current import path tries to preserve database IDs for workflows and workflow tools. That is useful for preserving references, but should be a configurable strategy.

Potential strategies:

- `preserve-id`: keep source IDs in the target environment.
- `generate-new-id`: create target-local IDs.
- `map-id`: generate new IDs and output an ID mapping file.

Resource conflicts should also be explicit, for example `fail`, `skip`, `update`, or `replace`.

### Avoid Implicit Owner Account Selection

The current import logic picks the earliest tenant owner account and performs imports as that user.

A more general implementation should allow the operator account to be specified explicitly, or use a clearly defined system/service account.

### Keep API Token Creation Explicit

`workflow_publish_api` marks exported workflows so import can create or reuse app API tokens.

This is useful, but should stay opt-in and be clearly named around API token creation, not workflow publishing, because workflow import already attempts to publish the workflow separately.

The current name is misleading:

- `workflow_publish_api` sounds like it controls whether the workflow is published.
- The actual behavior is writing `publish_api` into the export package.
- Import then uses `publish_api=true` to create or reuse an app API token.

Prefer a name that reflects the real behavior, such as `create_app_api_token_on_import`.

### Auto-Export Referenced Tools With Workflows

When exporting all workflows, the command should be able to discover and export tools referenced by those workflows automatically.

The current implementation returns immediately after `export_all_workflows=true`, so manually listed `tools`, `workflow_tools`, and `mcp_tools` are ignored in that mode. This makes full workflow migration easy to miss dependencies.

Preferred direction:

- Add an explicit option such as `include_referenced_tools`.
- Consider enabling it by default for `export_all_workflows`.
- Scan workflow graph tool nodes for referenced providers.
- Scan agent node tool configs as well, not only standalone tool nodes.
- De-duplicate discovered resources before export.
- Include a summary of discovered/exported/skipped dependencies.

Referenced resource handling:

- Workflow tools: export the `WorkflowToolProvider` and ensure the referenced workflow app is included.
- Custom API tools: export the API tool provider and its schema; credential inclusion should follow the explicit secret export policy.
- MCP tools: export MCP provider data according to the MCP secret/authentication policy.
- Built-in/plugin tools: do not serialize provider implementation as custom data; record dependency metadata and report that the target environment must have the plugin/provider installed and credentials configured or migrated separately.

### Add An Export Wizard

The export flow would benefit from a guided wizard for interactive use.

The wizard should not create a separate plan file. It should ask the user for export choices, keep the selection in memory, then directly write the final output JSON after confirmation.

Proposed command:

```bash
flask export-custom-data-wizard
```

Proposed flow:

1. Ask which tenant to export from, with an `all` option.
2. Ask which apps to export. First version should support workflow and advanced-chat apps only.
3. Ask whether to automatically export all tools referenced by the selected apps.
4. If enabled, parse selected app graphs, discover referenced tools, and de-duplicate them.
5. Ask whether additional tools should be exported manually.
6. Show a categorized tool selection menu:
   - Discovered workflow tools
   - Discovered custom API tools
   - Discovered MCP tools
   - Other workflow tools in the selected tenant
   - Other custom API tools in the selected tenant
   - Other MCP tools in the selected tenant
   - Built-in/plugin tools that were discovered but are dependency metadata only
7. Preselect tools discovered from the selected apps so the user can review and adjust them.
8. Ask for the output path and provide a sensible default.
9. Show a final summary and ask for confirmation.
10. Write the output JSON and print the export report.

Default output path should be generated automatically, for example:

```text
export-custom-data-YYYYMMDD-HHMMSS.json
```

The wizard should still reuse the same export logic as the non-interactive command, so behavior stays consistent across manual and scripted export paths.

## Agreed Direction

We agree that the export package should not use `tenant_name` as the target import selector.

Instead:

- Export should record source tenant information as metadata.
- Import should take the target tenant from CLI options.
- Source and target tenant names should be allowed to differ.
