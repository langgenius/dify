# Build a Workflow or Chatflow app

Four phases. Each ends with a gate; never skip one, even for a small app.

1. **Spec**: agree what the app must do. Gate: the human approves `spec.md`.
2. **Plan**: decide every node and config. Gate: the human approves `plan.md` and chooses how to build.
3. **Build**: create the app and build it slice by slice. Gate: each slice passes its tests and review.
4. **Hand over**: final checks, then publish and open access. Gate: the human says yes to going live.

## Rules

- Keep the working files in `difyctl/<app-slug>/` in the current folder: `spec.md`, `plan.md`, the package folder `app/`, and `live/` when changing an existing app. Keep `.ifpkg` files next to the folders, never inside one: an upload sends every file in the folder.
- Requirement ids (`R1`, `R2`, …) from the spec run through the plan, the build and the final report.
- One writer per draft at a time.
- Change an app only through packages: `export console_app package`, edit `app/app.yaml`, then `fill console_app package` and `check console_app package`, then `import console_app package`. Check before every import.
- Nothing goes live without the human's yes.
- **Report problems; never work around them.** When something blocks the agreed design, stop and tell the human what you found and the options. Examples: a tool that isn't configured, a missing credential or plugin, a requirement a node can't meet, a check you can't pass. Never swap in a substitute on your own: an HTTP Request or Code node in place of a tool, prompt text in place of a knowledge base, a dropped or weakened requirement.
- **Every change from the approved spec or plan needs the human's yes before you build it.** List each one: what changes, why, and what it costs. "Use defaults" or "go" approves only the options you already showed with your recommendation. It never approves a substitute you didn't show.
- **Prefer an existing tool; the human picks.** For each outside service or model, rank the options: an installed and configured tool, then an official or partner plugin, then a workflow tool. HTTP Request or Code comes last. A missing key is not a reason to pick HTTP Request or Code: ask the human for it.

## Read next

- [`build-workflow/change.md`](build-workflow/change.md): read first when the app already exists.
- [`build-workflow/spec.md`](build-workflow/spec.md): read in the spec phase.
- [`build-workflow/plan.md`](build-workflow/plan.md): read in the plan phase.
- [`build-workflow/build.md`](build-workflow/build.md): read in the build phase.
- [`build-workflow/handover.md`](build-workflow/handover.md): read when the build is done.
- [`build-workflow/package.md`](build-workflow/package.md): read when writing or reading `app.yaml`, or acting on a check result.
- Read [`plugins.md`](plugins.md) in the spec phase to find tools, models and knowledge bases, and when a plugin, model, tool or credential is missing.

## Limits

- A draft run that pauses on a human-input node can be resumed over difyctl only when the node is version 2, sends to the person who ran it, and has debug mode off; the result's `submit.run.form` hint then resumes it. Otherwise the result has no hint, and the human answers the form in the Dify console.
- A draft run doesn't wait for a trigger event; it runs at once. A schedule-started workflow tests fully: the trigger passes straight through. After a webhook or plugin trigger the trigger's variables are empty in a draft run, so test each node alone with `--inputs`.
- Loop and iteration nodes can't be tested alone; use a full draft run.
- Check takes an empty value you write as meant. It doesn't flag an End with no `outputs`, an if-else with no `cases`, a human-input node with no `user_actions`, an empty model, or an empty prompt or text. Review those fields against the plan; test runs find the rest.
- Iteration and loop need their start child written by hand. Fill doesn't create it, and the node list doesn't offer it. See [`build-workflow/package.md`](build-workflow/package.md).
- The node list has no plugin triggers and no Agent v1 strategies, and offers only Agents that already exist. If the plan needs one of these, ask the human to add it in the Dify console.
- With an app's Service API off, difyctl can't find, describe, export (exit 4), test, run or publish it; only fill, check and import work. An admin turns it on with `difyctl set service_api --app-id <app_id> --enabled`.
