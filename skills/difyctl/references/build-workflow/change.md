# Change an existing app

Use this path when the app already exists. It reuses the four phases.

1. Find the app and confirm with the human that it is the right one:

   ```bash
   difyctl get console_app --name <name> --json
   ```

   An app whose Service API is off does not show up here, and `describe console_app` cannot read it. If the app is missing, ask the human for its id and whether its Service API is off.

2. Export first.
   - List the versions. Note the `id` of the row with `current: true`: that is the live version.
   - Export that version and save it as `difyctl/<app-slug>/live.yml`. This is the live baseline.
   - Export the draft separately and keep its `draft_hash`. An export without `--workflow-id` returns the draft, not the live version.
   - Export exits 4 when the app's Service API is off. Ask an admin to turn it on.

   ```bash
   difyctl get console_app version --app-id <app_id> --json
   difyctl export console_app dsl --app-id <app_id> --workflow-id <version_id> --json | jq -r .data > difyctl/<app-slug>/live.yml
   difyctl export console_app dsl --app-id <app_id> --json
   ```

   If the draft differs from the live version, show the human the difference. Ask which one to start from. If the human picks live, import `live.yml` over the draft with the draft's `draft_hash`. Check the result as in [build.md](build.md).

   ```bash
   jq -Rs '{yaml_content: .}' difyctl/<app-slug>/live.yml |
     difyctl import console_app dsl --app-id <app_id> --mode yaml-content --draft-hash <draft_hash> --input @- --json
   ```

   Publishing replaces the live version, so that version id is the one to go back to. To go back, copy it into the draft, then publish:

   ```bash
   difyctl restore console_app version --app-id <app_id> --version-id <version_id> --json
   difyctl publish console_app --app-id <app_id> --json
   ```

   If restore fails, export the draft for a fresh `draft_hash`, import `live.yml` over the draft instead, then publish.

3. If `difyctl/<app-slug>/` has no `spec.md`, the app was built elsewhere. Rebuild a baseline spec from the export: the graph, the requirements you can infer, the inputs and outputs. The human confirms it.
4. Write the change as a "Change" section in the spec: new, changed and removed requirements and cases. Existing cases become regression cases.
5. Plan only the nodes that change, in slices as usual.
6. At the end, run every old case again. Then hand over as usual.
