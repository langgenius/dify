# Hand-over phase

Start when every slice in `plan.md` is ticked. In the commands below, `<mode>` is `workflow` for a Workflow app and `advanced_chat` for a Chatflow app.

1. Run the final acceptance run: every case in the spec, on the draft. Report pass or fail per requirement and per case. Show your reasoning for each `judged` case.
2. Stop at the human gate. Show the human the results, the "Changes during build" list from `plan.md`, and anything still open. Nothing goes live without a yes.
3. Publish. Keep `version_id` from the result. If the result has a `warning`, show it to the human. Then confirm the new version is live:

   ```bash
   difyctl publish console_app --app-id <app_id> --json
   difyctl get console_app version --app-id <app_id> --json
   ```

   The row whose `id` is that `version_id` must show `current: true`.

4. Settle access. A new app starts with the web app on and the Service API on. Ask the human about each item separately.
   - Web app: keep it on or turn it off. `--enabled` turns it on; `--enabled=false` turns it off. When it stays on, give the human the `url` from the result.

     ```bash
     difyctl set webapp <mode> --app-id <app_id> --enabled --json
     ```

   - Service API (needs an admin): keep it on or turn it off, with `--enabled` or `--enabled=false`. Warn the human first: with the Service API off, difyctl can no longer export, test, run, publish or restore this app. Import still works. An admin can turn it back on with `difyctl set service_api <mode> --app-id <app_id> --enabled`.

     ```bash
     difyctl set service_api <mode> --app-id <app_id> --enabled --json
     ```

   - Who may open the web app (Enterprise). `--access-mode` is one of `public`, `private_all` or `sso_verified`:

     ```bash
     difyctl set webapp_access <mode> --app-id <app_id> --access-mode <access_mode> --json
     ```

     To let only chosen members or groups in (`private`), the human must pick them in the Dify console. The mode also applies to `difyctl run`, so the logged-in account must be allowed by it for the smoke test below.

5. Smoke test the live app with one acceptance case. Pass `--inputs` when the start node declares variables.

   ```bash
   difyctl run console_app workflow --app-id <app_id> --inputs '{"<var>": "<value>"}' --json
   difyctl run console_app advanced_chat --app-id <app_id> --query "<message>" --inputs '{"<var>": "<value>"}' --json
   ```

6. Close. Mark `plan.md` as published with the `version_id`, the date and the url. Give the human a short summary.
