# Change an existing app

Use this path when the app already exists. It reuses the four phases.

1. Find the app and confirm with the human that it is the right one:

   ```bash
   difyctl get console_app --name <name> --json
   ```

   If the app is missing, its Service API may be off (see Limits in `build-workflow.md`). Ask the human for its id.

2. Export first.
   - List the versions. Note the `id` of the row with `current: true`: that is the live version.
   - Export that version and unzip it into `difyctl/<app-slug>/live/`. This is the live baseline.
   - Export the draft into `app/` with its hash, as steps 1 and 2 of each slice in [build.md](build.md) do. An export without `--workflow-id` returns the draft, not the live version.

   ```bash
   difyctl get console_app version --app-id <app_id> --json
   difyctl export console_app package --app-id <app_id> --workflow-id <version_id> --output difyctl/<app-slug>/live.ifpkg --json
   rm -rf difyctl/<app-slug>/live
   unzip -q difyctl/<app-slug>/live.ifpkg -d difyctl/<app-slug>/live
   diff difyctl/<app-slug>/live/app.yaml difyctl/<app-slug>/app/app.yaml
   ```

   If the draft differs from the live version, show the human the difference. Ask which one to start from. If the human picks live, check `live/`, then import it over the draft with the draft's `draft_hash`. Handle the result as in [build.md](build.md), then export the draft again before you edit it.

   ```bash
   difyctl check console_app package --package difyctl/<app-slug>/live --app-id <app_id> --json
   difyctl import console_app package --package difyctl/<app-slug>/live --app-id <app_id> --draft-hash <draft_hash> --json
   ```

   Publishing replaces the live version, so that version id is the one to go back to. To go back, copy it into the draft, then publish:

   ```bash
   difyctl restore console_app version --app-id <app_id> --version-id <version_id> --json
   difyctl publish console_app --app-id <app_id> --json
   ```

   If restore fails, take a fresh `draft_hash` with `difyctl describe console_app --app-id <app_id> --json`, check and import `live/` over the draft instead, then publish.

3. If `difyctl/<app-slug>/` has no `spec.md`, the app was built elsewhere. Rebuild a baseline spec from `live/app.yaml`: the graph, the requirements you can infer, the inputs and outputs. The human confirms it.
4. Write the change as a "Change" section in the spec: new, changed and removed requirements and cases. Existing cases become regression cases.
5. Plan only the nodes that change, in slices as usual. Build each slice as [build.md](build.md) says: fill and check before every import. Fill lays out the whole canvas again, so tell the human before the first import that their node arrangement will change.
6. At the end, run every old case again. Then hand over as usual.
