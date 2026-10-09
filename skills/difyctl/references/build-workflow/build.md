# Build phase

## Contents

- Before the first slice
- Each slice
- When something fails
- Plan changes during build
- Building with subagents

In the commands below, `<mode>` is `workflow` for a Workflow app and `advanced_chat` for a Chatflow app.

## Before the first slice

Check two things: the human approved the plan, and the human chose how to build.

When you change an existing app, skip creating it and skip the skeleton slice. Start from the current draft: `app.yml` from the first export.

Create the app once:

```bash
difyctl create console_app workflow --name "<name>" --json
difyctl create console_app advanced_chat --name "<name>" --json
```

Write the `app_id` into the header of `plan.md`. A new app already has an empty draft, so you can export it straight away.

Work on this one app for the whole build. Change it by importing over its draft. Never make copies.

## Each slice

1. Export the draft. The result is `{"data": "<yaml>", "draft_hash": "<hash>"}`. Keep `draft_hash`. On the first slice, also save `data` as `app.yml`.

   ```bash
   difyctl export console_app dsl --app-id <app_id> --json | jq -r .draft_hash
   difyctl export console_app dsl --app-id <app_id> --json | jq -r .data > difyctl/<app-slug>/app.yml
   ```

2. Write the slice's nodes and edges into `app.yml` by converting the node table. Make no new decisions here. Read [dsl.md](dsl.md) for where things go in the YAML.
3. Import over the draft with that `draft_hash`:

   ```bash
   jq -Rs '{yaml_content: .}' difyctl/<app-slug>/app.yml |
     difyctl import console_app dsl --app-id <app_id> --mode yaml-content --draft-hash <draft_hash> --input @- --json
   ```

   - Send the YAML through stdin with `--input @-`, as above. Do not pass it as `--yaml-content "$(cat …)"`: a large file breaks the command line.
   - A failed import exits 1 with an error envelope on stderr that carries the server's message. Stop and show the human the message.
   - If the draft changed since your export, the server's message says to export again. Someone else changed the draft. Export again, show the human the difference, and never overwrite it.
   - A successful import prints a result. Check its `status`. Go on only when it is `completed`. On `completed-with-warnings`, stop and read `warnings`.
   - `pending` means the DSL version differs from the server's, and the draft has not changed. Show the human `imported_dsl_version` and `current_dsl_version`. If they agree, run `difyctl confirm console_app dsl_import --import-id <id> --json` with the result's `id`.
   - Each import changes the hash. Export again before the next import.
   - Read [dsl.md](dsl.md) for what else an import changes.

4. Test each new node alone with the plan's inputs. Fix it, import again, test again.

   ```bash
   difyctl test node workflow --app-id <app_id> --node-id <node_id> --inputs '{"#<node_id>.<var>#": "<value>"}' --json
   difyctl test node advanced_chat --app-id <app_id> --node-id <node_id> --query "<message>" --json
   ```

   A node test reuses the values the last full draft run saved. Override any value the node reads with `--inputs`, keyed `#<node_id>.<var>#`.

5. Run the whole draft on the slice's acceptance cases. Check each result with the case's check type.

   ```bash
   difyctl test console_app workflow --app-id <app_id> --inputs '{"<var>": "<value>"}' --json
   difyctl test console_app advanced_chat --app-id <app_id> --query "<message>" --inputs '{"<var>": "<value>"}' --json
   ```

   Pass `--inputs` when the start node declares variables. Leave it out when there are none.

   Record the run ids. List the latest draft runs with:

   ```bash
   difyctl get run --app-id <app_id> --triggered-from debugging --limit 5 --json
   ```

6. Review the slice against the plan, and the YAML against the node table.
7. Tick the slice in `plan.md` and add its run ids. The ticked list is the progress record. A new session resumes at the first unticked slice.

## When something fails

Find the node that failed and what it received:

```bash
difyctl get run node --app-id <app_id> --run-id <run_id> --json
```

The plan is the source of truth. If a fix changes a decision (a prompt, a condition, a node type), update the plan first, then the YAML.

## Plan changes during build

You decide every plan change that does not touch the spec. For each one:

1. Update the plan.
2. Log it under "Changes during build": what changed, why, and what it costs if wrong.

The human reviews that list at hand over.

Stop and ask the human when a change touches the spec: a requirement, an acceptance case, a resource or the mode.

## Building with subagents

- Give one slice at a time to a fresh subagent. Pass it the slice text, the file paths and the `app_id`.
- The subagent runs steps 1 to 5. A reviewer subagent runs step 6.
- Never run two subagents on one app at the same time. Their imports would collide on the draft hash.

The build phase never publishes.
