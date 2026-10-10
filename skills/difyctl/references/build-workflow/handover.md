# Hand-over phase

Start when every slice in `plan.md` is ticked. `<mode>` is `workflow` or `advanced_chat`.

1. Run every acceptance case in the spec on the draft. Report pass or fail per requirement and per case, with your reasoning for each `judged` case.
2. Check the release, after the acceptance run so `tested` covers the current draft:

   ```bash
   difyctl check console_app release --app-id <app_id> --json
   ```

   Fix every item in `issues`. If `tested` fails, run the draft again. Go on only when `ready` is true.

3. Stop at the human gate. Show in plain words: the `changes` against the published version, the `checks`, the acceptance results, the "Changes during build" list, and anything still open. Nothing goes live without a yes.
4. On a yes, publish. Show any `warning` in the result. Then confirm the row whose `id` is the result's `version_id` shows `current: true`:

   ```bash
   difyctl publish console_app --app-id <app_id> --json
   difyctl get console_app version --app-id <app_id> --json
   ```

5. Settle access. A new app starts with the web app and the Service API on. Ask the human about each one. `--enabled=false` turns a setting off. Agent apps use the `agent` variant of each command.
   - Web app. When it stays on, give the human the `url` from the result.

     ```bash
     difyctl set webapp <mode> --app-id <app_id> --enabled --json
     ```

   - Service API (needs an admin). Warn the human first: with it off, difyctl can't export, test, run, publish or find this app; only import still works. Note the app id first; an admin turns it back on with `--enabled`.

     ```bash
     difyctl set service_api --app-id <app_id> --enabled --json
     ```

   - Who may open the web app (Enterprise): `public`, `private_all` or `sso_verified`. Picking members or groups (`private`) is done in the Dify console. `difyctl run` obeys this too, so the logged-in account must be allowed for the smoke test.

     ```bash
     difyctl set webapp_access --app-id <app_id> --access-mode <access_mode> --json
     ```

6. Smoke test the live app with one acceptance case. Chatflow also takes `--query "<message>"`.

   ```bash
   difyctl run console_app <mode> --app-id <app_id> --inputs '{"<var>": "<value>"}' --json
   ```

7. Close. Mark `plan.md` as published with the `version_id`, the date and the url. Give the human a short summary that lists every change from the spec and plan, and when the human approved it.
