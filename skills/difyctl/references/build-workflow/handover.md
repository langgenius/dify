# Hand-over phase

Start when every slice in `plan.md` is ticked. In the commands below, `<mode>` is `workflow` for a Workflow app and `advanced_chat` for a Chatflow app.

1. Run the final acceptance run: every case in the spec, on the draft. Report pass or fail per requirement and per case. Show your reasoning for each `judged` case.
2. Check the release: `difyctl check console_app release --app-id <app_id> --json`. Run it after the acceptance run, so `tested` covers the current draft. The top-level `ready` is true only when every check passes. Fix every item in `issues`. If `tested` fails, run the draft again, then check again. Don't go on until `ready` is true.
3. Stop at the human gate. Show the human the `changes` against the published version in plain words, the `checks` (`draft_valid` and `tested`), the acceptance results, the "Changes during build" list from `plan.md`, and anything still open. Nothing goes live without a yes.
4. Publish only when `ready` is true and the human says yes. Keep `version_id` from the result. If the result has a `warning`, show it to the human. Then confirm the new version is live:

   ```bash
   difyctl publish console_app --app-id <app_id> --json
   difyctl get console_app version --app-id <app_id> --json
   ```

   The row whose `id` is that `version_id` must show `current: true`.

5. Settle access. A new app starts with the web app on and the Service API on. Ask the human about each item separately.
   - Web app: keep it on or turn it off. `--enabled` turns it on; `--enabled=false` turns it off. When it stays on, give the human the `url` from the result.

     ```bash
     difyctl set webapp <mode> --app-id <app_id> --enabled --json
     ```

   - Service API (needs an admin): keep it on or turn it off, with `--enabled` or `--enabled=false`. Warn the human first: with the Service API off, difyctl can no longer export, test, run, publish or restore this app, and it no longer appears in `difyctl get console_app` or `describe console_app`. Import still works. Note the app id before turning it off. An admin can turn it back on with `difyctl set service_api --app-id <app_id> --enabled`.

     ```bash
     difyctl set service_api --app-id <app_id> --enabled --json
     ```

   - Who may open the web app (Enterprise). `--access-mode` is one of `public`, `private_all` or `sso_verified`:

     ```bash
     difyctl set webapp_access --app-id <app_id> --access-mode <access_mode> --json
     ```

     For an agent app, use `set webapp_access agent`, `set service_api agent` and `set webapp agent`. To let only chosen members or groups in (`private`), the human must pick them in the Dify console. The mode also applies to `difyctl run`, so the logged-in account must be allowed by it for the smoke test below.

6. Smoke test the live app with one acceptance case. Pass `--inputs` when the start node declares variables.

   ```bash
   difyctl run console_app workflow --app-id <app_id> --inputs '{"<var>": "<value>"}' --json
   difyctl run console_app advanced_chat --app-id <app_id> --query "<message>" --inputs '{"<var>": "<value>"}' --json
   ```

7. Close. Mark `plan.md` as published with the `version_id`, the date and the url. Give the human a short summary.
