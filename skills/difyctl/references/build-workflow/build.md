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

1. Take the draft hash, then export the draft. Keep `info.draft_hash`. Take the hash first: an edit made between the two calls then refuses your import instead of being lost.

   ```bash
   difyctl describe console_app --app-id <app_id> --json
   difyctl export console_app package --app-id <app_id> --output difyctl/<app-slug>/draft.ifpkg --json
   ```

2. Unzip the export into an empty `app/`. Without `unzip`, use `python3 -m zipfile -e <file> <dir>`, or on Windows `tar -xf <file> -C <dir>`.

   ```bash
   rm -rf difyctl/<app-slug>/app
   unzip -q difyctl/<app-slug>/draft.ifpkg -d difyctl/<app-slug>/app
   ```

3. Write the slice's nodes, edges and notes into `app/app.yaml` from the plan. Make no new decisions. Read [package.md](package.md).
4. Fill, and unzip the filled package over `app/`.

   ```bash
   difyctl fill console_app package --package difyctl/<app-slug>/app --output difyctl/<app-slug>/filled.ifpkg --json
   unzip -o -q difyctl/<app-slug>/filled.ifpkg -d difyctl/<app-slug>/app
   ```

5. Check. Fix every `error` by its `loc`, using `node_specs` and the issue's `hint`, then go back to step 4. Go on when `valid` is true and you edited nothing since the last fill. [package.md](package.md) says what each code means and what to do with warnings.

   ```bash
   difyctl check console_app package --package difyctl/<app-slug>/app --app-id <app_id> --json
   ```

6. Import over the draft. Leave `--preserve-agent-bindings` at its default: roster Agent nodes and workspace skill links stay linked.

   ```bash
   difyctl import console_app package --package difyctl/<app-slug>/app --app-id <app_id> --draft-hash <draft_hash> --json
   ```

   - `completed`: go on. The next slice starts at step 1; the hash changed.
   - `completed-with-warnings`: stop and read `warnings`.
   - `pending`: the DSL version differs from the server's. Show the human both versions. On a yes, run `difyctl confirm console_app dsl_import --import-id <id> --json`.
   - `dsl_invalid`: fix the issues in `details` by `loc`, then fill and check again.
   - `app_package_invalid`: show the human the message and each item in `details`. A skill link the workspace lacks is the human's to fix.
   - `draft_changed` (409, also on `confirm`): someone else edited the draft since you took the hash. Export again, show the human the difference, and never overwrite it.
   - Any other failure: stop and show the human the message.

7. Test each new node alone. This is also how to read what a branch behind a human-input pause produces: test the node that writes it. It reuses the last full run's values; override them with `--inputs`, keyed `#<node_id>.<var>#`. Give a file variable a local file with `--files '{"<variable>": "<path>"}'`.

   ```bash
   difyctl test node <mode> --app-id <app_id> --node-id <node_id> --inputs '{"#<node_id>.<var>#": "<value>"}' --json
   ```

8. Run the whole draft on the slice's acceptance cases; check each by its check type. A run with loops or several model calls can take minutes: give the command a long timeout, or write its output to a file. Run one draft at a time; runs can queue on the server. Check each run's token count: a tool that returns whole pages can cost a lot, so trim its output in a Code node before a model reads it. When the result is `incomplete`, the run may still be going on the server: follow the hint when there is one, or else find the draft run with `difyctl get run --app-id <app_id> --json`. Chatflow also takes `--query "<message>"`. Leave out `--inputs` when the start node has no variables.

   ```bash
   difyctl test console_app <mode> --app-id <app_id> --inputs '{"<var>": "<value>"}' --json
   ```

9. Review the slice against the plan, and `app/app.yaml` against the node table and the notes table.
10. Tick the slice in `plan.md` with its run ids. A new session resumes at the first unticked slice.

## When something fails

Find the node that failed and what it received:

```bash
difyctl get run node --app-id <app_id> --run-id <run_id> --json
```

A fix that changes the plan or spec follows the next section.

## Changes to the plan or spec

Never build a change first and report it later; ask as the rules in `build-workflow.md` say. On a yes, update the plan (and the spec, if it changes), then `app/app.yaml`. Log it under "Changes during build" with when the human approved it.

The build phase never publishes.
