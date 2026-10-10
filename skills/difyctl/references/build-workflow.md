# Build a Workflow or Chatflow app

Four phases. Each ends with a gate; never skip one, even for a small app.

1. **Spec**: agree what the app must do. Gate: the human approves `spec.md`.
2. **Plan**: decide every node and config. Gate: the human approves `plan.md` and chooses how to build.
3. **Build**: create the app and build it slice by slice. Gate: each slice passes its tests and review.
4. **Hand over**: final checks, then publish and open access. Gate: the human says yes to going live.

## Rules

- Keep the working files in `difyctl/<app-slug>/` in the current folder: `spec.md`, `plan.md`, `app.yml`, and `live.yml` when changing an existing app.
- Requirement ids (`R1`, `R2`, …) from the spec run through the plan, the build and the final report.
- One writer per draft at a time.
- Nothing goes live without the human's yes.
- Superpowers, visual tools and subagents are optional. Use them when you have them; the phases work without them.

## Read next

- [`build-workflow/change.md`](build-workflow/change.md): read first when the app already exists.
- [`build-workflow/spec.md`](build-workflow/spec.md): read in the spec phase.
- [`build-workflow/plan.md`](build-workflow/plan.md): read in the plan phase.
- [`build-workflow/build.md`](build-workflow/build.md): read in the build phase.
- [`build-workflow/handover.md`](build-workflow/handover.md): read when the build is done.
- [`build-workflow/dsl.md`](build-workflow/dsl.md): read when writing or reading app YAML.
- Read [`plugins.md`](plugins.md) in the spec phase to find tools, models and knowledge bases, and when a plugin, model, tool or credential is missing.

## Limits

- A draft run paused on a human-input node can't be resumed over difyctl.
- Trigger-started workflows (webhook, schedule, plugin) can't be draft-tested.
- Loop and iteration nodes can't be tested alone; use a full draft run.
