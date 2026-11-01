# Review a live app

Use this path for a bounded review of a published Workflow or Chatflow. It ends with a finding, not an app edit. Read [change.md](change.md) when the evidence supports a change; that path keeps the existing spec, plan, regression and human gates.

## Set the review bounds

Agree these with the human before collecting evidence:

- The server, workspace, app id, target release and requirements to check.
- The observation window, including timezone and whether its end is exclusive.
- What counts as enough evidence: minimum completed runs, relevant cases and required checks. Choose these for the task; no fixed sample count proves general health.
- Maximum pages, detailed/node inspections and elapsed time. Review existing runs only; starting runs, changing settings, importing and publishing are outside this review.

Use the existing login, operation discovery and effect checks. Missing access or an unsupported read is a blocker, not permission to change settings, switch identity or substitute another interface.

## Read the bounded evidence

1. Inspect the operation's help. Select real-use runs explicitly; the run list defaults to draft tests. Start without a status filter so failures and unfinished runs remain visible:

   ```bash
   difyctl get run --app-id <app_id> --triggered-from app-run --json
   ```

2. Follow the response's next-page hints within the budget. Use each run's timestamp to select the agreed window. Record the pages and time range inspected, missing data and the stopping reason. Reaching a page limit while the window is still incomplete is a coverage gap, not proof that no other runs exist.
3. Record the version reported by each run and where it came from. Keep its attribution to the target release `unknown` unless the evidence establishes it. The version currently marked live does not identify the version of an earlier run. Keep draft and live evidence separate.
4. Check the observed inputs and outputs against the agreed requirements. A succeeded status alone does not establish business correctness. Keep unfinished or incomplete results separate from completed cases; do not treat a missing result as a pass.
5. Inspect only the necessary run details and node steps within the budget. Read [build.md](build.md) for the existing node-failure inspection path. Retain only the evidence needed to explain the finding; exclude credentials, secrets and unrelated user content from shared reports.

## Decide and stop

Use one of these outcomes:

- **Change proposed:** an observed failure within the agreed window, attributable to the target release, establishes a specific requirement violation. Identify the affected requirement, run/version evidence and relevant node finding; distinguish observation from a suspected cause. A verified defect can justify a proposal even when the sample is too small for an overall health conclusion. Read [change.md](change.md) to take it through the existing change and regression process. Do not edit or publish during triage.
- **Insufficient evidence:** no verified defect attributable to the target release within the agreed window justifies a change, and the agreed sample, window coverage, release attribution or requirement checks are incomplete. Preserve failures from other or unknown releases as observations; they do not establish a defect in the target release. State the gap and what would resolve it; do not infer health or invent a fix.
- **No change needed within the reviewed scope:** the agreed evidence is sufficient, the reviewed runs are attributable to the target release, and the observed checks pass. Report the window, sample and checks; make no claim about unobserved traffic or future reliability.

Stop when the budget is exhausted, the bounded review is complete, or access/collection is blocked. Keep any verified finding and name the remaining uncertainty. Do not keep polling or expand the window, sample, reads or scope on your own.

Give the human one short report: target and window; requirements; sample and coverage; run/version evidence or `unknown`; observed results; budget used and stopping reason; outcome; and the next step. Reuse existing hand-over and change records; do not create a second approval process.
