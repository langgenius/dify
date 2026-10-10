# Build phase

Start only when the human approved the plan and chose how to build. `<mode>` is `workflow` for a Workflow app and `advanced_chat` for a Chatflow app.

## Before the first slice

When you change an existing app, skip creating it and the skeleton slice. Start from the current draft.

Otherwise create the app once, and write its `app_id` into `plan.md`:

```bash
difyctl create console_app <mode> --name "<name>" --json
```

Build this one app; never make copies.

## Each slice

1. Export the draft. Keep `draft_hash`. Save `data` as `app.yml` on the first slice.

   ```bash
   difyctl export console_app dsl --app-id <app_id> --json
   ```

2. Write the slice's nodes and edges into `app.yml` from the node table. Make no new decisions. Read [dsl.md](dsl.md).
3. Check the YAML. Fix every `error` by its `loc` and check again until `valid` is true.

   ```bash
   jq -Rs '{yaml_content: .}' difyctl/<app-slug>/app.yml |
     difyctl check console_app dsl --app-id <app_id> --input @- --json
   ```

4. Import over the draft. Always send the YAML through stdin.

   ```bash
   jq -Rs '{yaml_content: .}' difyctl/<app-slug>/app.yml |
     difyctl import console_app dsl --app-id <app_id> --mode yaml-content --draft-hash <draft_hash> --input @- --json
   ```

   - `completed`: go on. Export again before the next import; the hash changed.
   - `completed-with-warnings`: stop and read `warnings`.
   - `pending`: the DSL version differs from the server's. Show the human both versions. On a yes, run `difyctl confirm console_app dsl_import --import-id <id> --json`.
   - `dsl_invalid`: fix the issues in `details` by `loc`.
   - The draft changed since your export: someone else edited it. Export again, show the human the difference, and never overwrite it.
   - Any other failure: stop and show the human the message.

5. Test each new node alone. It reuses the last full run's values; override them with `--inputs`, keyed `#<node_id>.<var>#`. Give a file variable a local file with `--files '{"<variable>": "<path>"}'`.

   ```bash
   difyctl test node <mode> --app-id <app_id> --node-id <node_id> --inputs '{"#<node_id>.<var>#": "<value>"}' --json
   ```

6. Run the whole draft on the slice's acceptance cases; check each by its check type. Chatflow also takes `--query "<message>"`. Leave out `--inputs` when the start node has no variables.

   ```bash
   difyctl test console_app <mode> --app-id <app_id> --inputs '{"<var>": "<value>"}' --json
   ```

7. Review the slice against the plan, and the YAML against the node table.
8. Tick the slice in `plan.md` with its run ids. A new session resumes at the first unticked slice.

## When something fails

Find the node that failed and what it received:

```bash
difyctl get run node --app-id <app_id> --run-id <run_id> --json
```

A fix that changes the plan or spec follows the next section.

## Changes to the plan or spec

Never build a change first and report it later. For each change:

1. Stop and tell the human what changes, why, and what it costs.
2. On a yes, update the plan (and the spec, if it changes), then the YAML.
3. Log it under "Changes during build" with when the human approved it.

The build phase never publishes.
