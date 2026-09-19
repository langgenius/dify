# App DSL bundles

An app bundle is a ZIP containing `manifest.yaml` and one independent DSL file per app snapshot.
It supports workflow, chatflow (`advanced-chat`), chat, legacy Agent (`agent-chat`), text generation
(`completion`), and Agent apps. Each referenced workflow tool includes the published workflow version
it uses, recursively. Shared dependencies appear once; relationships may contain cycles.

Request `include_workflow_tools=true` from an app export endpoint, or use the CLI's
`--include-workflow-tools --output app.zip` option. This returns a bundle even when the app has no
workflow tools. Without that option, the endpoint returns its existing single-app YAML format.
Browser app exports request bundles automatically. Import accepts the ZIP through the existing file
uploader, CLI, or `bundle-content` API mode with base64 content in `yaml_content`.

## Manifest structure

The manifest version is independent of the app DSL version (`0.8.0`). Resource and relationship kinds
identify their schemas; application-specific configuration stays in the individual DSL files.

```yaml
kind: app_bundle
version: '1'
entrypoint: app_1
resources:
  app_1:
    kind: app
    file: apps/app_1.yaml
    enable_api: true
    enable_site: true
  app_2:
    kind: app
    file: apps/app_2.yaml
    enable_api: true
    enable_site: false
    workflow:
      published: true
      marked_name: Tool release
      marked_comment: Published configuration used by this tool
  tool_1:
    kind: workflow_tool
    app: app_2
    name: lookup
    label: Lookup
    icon:
      content: 🔎
      background: '#FFFFFF'
    description: Look up an item
    parameters: []
    privacy_policy: ''
    labels: []
relationships:
  - kind: uses_tool
    source: app_1
    target: tool_1
```

`entrypoint` identifies the app returned by import. Resource IDs are bundle-local markers, not source
workspace IDs. Each app file also contains its own `bundle_id`, matching its resource ID. The file
`apps/app_1.yaml`, for example, starts with:

```yaml
version: 0.8.0
kind: app
bundle_id: app_1
app:
  name: My app
  mode: agent-chat
# The app's normal model_config, workflow, or agent package data follows.
```

An `app` resource records access settings and, for workflow/chatflow apps, optional workflow
publication metadata. A `workflow_tool` resource records the tool deployment and points to its
published workflow app. Each `uses_tool` relationship links the consuming app to that deployment.
Tool nodes, legacy Agent tool lists, and Agent package tool selections use the deployment marker
until import replaces it with the new provider ID and tool name. Agent prompt mentions are remapped
at the same time.

Import creates the apps, restores published workflow snapshots, registers their tools, and commits
them together. Tool name collisions in the destination workspace receive a numeric suffix, with all
references updated consistently. Agent app DSL carries an editable draft and imports unpublished,
with API and site access disabled, matching standalone Agent DSL import. Overwriting an existing app
continues to support workflow and chatflow apps of the same mode.

## Extending the format

New resource types can add a new resource `kind` and its schema without adding another top-level
collection. New relationship types similarly add a relationship `kind`, endpoint constraints, and
import/export handling. Deployment-specific fields belong to their resource schema; graph or model
configuration belongs in the app DSL. Changes requiring new reader behavior must advance the
manifest version and define any necessary migration.

Readers reject unsupported versions, resource kinds, relationship kinds, and fields instead of
silently dropping a required dependency or deployment. They verify independent markers, exact file
membership, relationship endpoints, matching tool references, and reachability from the entrypoint.
Archives are bounded to 128 app files and 10 MB both compressed and expanded. YAML aliases, duplicate
members, unexpected paths, and encrypted ZIP entries are rejected.

The earlier `workflow_bundle` version `1` format remains importable. Its workflow and tool collections
are normalized to typed app resources before import; subsequent exports use `app_bundle`.
