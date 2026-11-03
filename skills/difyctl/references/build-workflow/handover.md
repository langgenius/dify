# Hand-over phase

Start when every slice in `plan.md` is ticked. `<mode>` is `workflow` or `advanced_chat`.

1. Run every acceptance case in the spec on the draft. Report pass or fail per requirement and per case, with your reasoning for each `judged` case.
2. Check the release, after the acceptance run so `tested` covers the current draft:

   ```bash
   difyctl check console_app release --app-id <app_id> --json
   ```

   Fix every item in `issues`. If `tested` fails, run the draft again; a run that paused on a human-input node doesn't count, so include a case that ends. Go on only when `ready` is true.

3. Stop at the human gate. Show in plain words: the `changes` against the published version, the `checks`, the acceptance results, the "Changes during build" list, and anything still open.
4. On a yes, publish. Show any `warning` in the result. Then confirm the row whose `id` is the result's `version_id` shows `current: true`:

   ```bash
   difyctl publish console_app --app-id <app_id> --json
   difyctl get console_app version --app-id <app_id> --json
   ```

5. Settle access. A new app starts with the web app and the Service API on. Ask the human about each one. `--enabled=false` turns a setting off.
   - Web app. When it stays on, give the human the `url` from the result.

     ```bash
     difyctl set webapp <mode> --app-id <app_id> --enabled --json
     ```

   - Service API (needs an admin). Warn the human first what turning it off costs (see Limits in `build-workflow.md`), and note the app id. If the human wants it off, record that and turn it off after the smoke test in step 6: `difyctl run` fails with `service_api_disabled` while it is off.

     ```bash
     difyctl set service_api --app-id <app_id> --enabled --json
     ```

   - Who may open the web app (Enterprise). Read the current mode with `difyctl describe webapp_access --app-id <app_id> --json`; a new app can start as `private` with no members, which refuses even you. Ask the human which mode to set: `public`, `private_all` or `sso_verified`. Picking members or groups (`private`) is done in the Dify console. `difyctl run` obeys this too, so the logged-in account must be allowed for the smoke test; otherwise it exits 4 with `user_not_allowed_for_private_app`. `public` exits 4 with `webapp_public_access_disabled` when the server disables public web apps; offer the human `private_all` or `sso_verified`.

     ```bash
     difyctl set webapp_access --app-id <app_id> --access-mode <access_mode> --json
     ```

6. Smoke test the live app with one acceptance case. Chatflow also takes `--query "<message>"`. Skip this for a trigger-started app, which `difyctl run` can't start; after its first scheduled time, list its runs with `difyctl get run --app-id <app_id> --triggered-from schedule --json` (or `webhook`, `plugin`) and describe the newest.

   ```bash
   difyctl run console_app <mode> --app-id <app_id> --inputs '{"<var>": "<value>"}' --json
   ```

   Then, if the human chose to turn the Service API off in step 5, turn it off now with `--enabled=false`.

7. Close. Mark `plan.md` as published with the `version_id`, the date and the url. Give the human a short summary that lists every change from the spec and plan, and when the human approved it.
