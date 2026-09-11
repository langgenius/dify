"""Static user-facing strings the Dify Builder engine emits.

Pure data (+ stdlib re). The service-layer Localizer (M2) value-matches item
strings against this catalog and translates matches into the user's language;
LLM-generated prose (already localized by M1) never matches and is left as-is.
Interpolated strings are matched as TEMPLATES so the static frame is translated
and the dynamic parts (counts, ids, already-localized prose) are re-inserted.
"""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Template:
    pattern: re.Pattern
    template: str
    # Capture-group names that are prose vs. re-inserted verbatim -- advisory/
    # documentation only. The Localizer (services.dify_builder.agent.localize)
    # does not read this field: it re-inserts ALL captured groups verbatim via
    # `.format(**groups)` regardless of what's listed here. It exists so a
    # reader can see, per group, whether the value is expected to already be
    # localized prose (kept as-is) or a raw technical value (also kept as-is,
    # but for a different reason) -- it does not change behavior.
    translate_fields: frozenset[str]


# Non-interpolated static strings (reply_text microcopy, card chrome, decision
# texts, checkpoint labels, static summary items, form chrome, bodies).
PLAIN: frozenset[str] = frozenset(
    {
        # reply_text microcopy
        "Let's clarify the requirements.",
        "Here's the initial plan.",
        "Recommended resources.",
        "Plan v2 ready for approval.",
        "Workflow built on the canvas.",
        "Provide test inputs (or use mock data) to run the test.",
        "Tests passed; ready for review.",
        "The run failed on its inputs — provide test data and retry.",
        "Here's the impact of your change.",
        "Change plan ready for approval.",
        "Applied the changes to the canvas.",
        "Provide test inputs (or use mock data) to run the affected-path test.",
        "Let's adjust the change.",
        "Re-approve to apply the change.",
        "Provide test inputs (or use mock data) to run validation.",
        "Restarting the plan.",
        "Revised plan.",
        "I couldn't build a valid workflow graph -- see the error above. Adjust the plan and approve again.",
        "Test failed — here's a proposed fix to review.",
        "Test failed — no safe automatic fix; edit or keep draft.",
        "No automatic fix found — review the diagnosis and edit the canvas manually, or reject.",
        # card titles
        "Test run",
        "Review",
        "Diagnosis",
        "Build plan",
        "Change plan",
        "Affected-path tests",
        "Build complete",
        "Couldn't build the workflow",
        "Current workflow",
        "Draft kept",
        "Edit published",
        "High-impact rules",
        "Model not configured",
        "Proceeding with sensible defaults",
        "Test failed",
        "Validation",
        # model-config-failure surface (build + edit)
        "The test failed because the workflow's model isn't configured. Configure it "
        "(or change the model), then re-run — this isn't a workflow-logic issue.",
        # subtitles
        "All checks passed",
        "Failed",
        "checklist",
        # stat labels
        "runs",
        "errors",
        # decision texts
        "Accepted skill learning",
        "Approved the change plan",
        "Approved the fix; retesting",
        "Approved the plan",
        "Checklist still failing, re-diagnosing",
        "Chose to publish",
        "Confirmed resources",
        "Continue adjusting",
        "Kept the draft despite the failure",
        "Kept the draft",
        "Published the fix",
        "Rejected the proposed repair",
        "Requested a revert",
        "Run affected-path tests",
        "Run tests",
        "Skipped skill learning",
        "Submitted edit rules",
        "Submitted requirements",
        # checkpoint labels
        "Pre-build checkpoint",
        "Pre-edit checkpoint",
        # form chrome / bodies / static summary items
        "Ask each time",
        "Change",
        "Nodes",
        "Prefer audited",
        "Status",
        "Workflow",
        "I filled in typical requirements; edit and submit to adjust.",
        "These rules change branching and output; review before applying.",
        "Tests passing",
        "Applied the change plan",
        "Affected paths tested",
        "I couldn't generate a valid workflow graph from this plan. "
        "Adjust the goal or the plan and approve again to retry.",
        "Source: checklist",
        # status values shown in SummaryRow (value= positional/kwarg, invisible to the guard regex)
        "Complete",
        "Published",
        "config edit",
        # (add any others the guard test reports)
    }
)


TEMPLATES: list[Template] = [
    Template(
        pattern=re.compile(r"^Workflow built \((?P<count>\d+) nodes\)$"),
        template="Workflow built ({count} nodes)",
        translate_fields=frozenset(),  # count re-inserted verbatim
    ),
    Template(
        pattern=re.compile(r"^Read (?P<count>\d+) nodes$"),
        template="Read {count} nodes",
        translate_fields=frozenset(),
    ),
    Template(
        pattern=re.compile(r"^(?P<count>\d+) connections$"),
        template="{count} connections",
        translate_fields=frozenset(),
    ),
    Template(
        pattern=re.compile(r"^Root cause: (?P<value>.+)$", re.DOTALL),
        template="Root cause: {value}",
        translate_fields=frozenset({"value"}),  # value is M1-localized prose; kept
    ),
    Template(
        pattern=re.compile(r"^Culprit node: (?P<value>.+)$"),
        template="Culprit node: {value}",
        translate_fields=frozenset(),  # value is a node id; re-inserted verbatim
    ),
    Template(
        pattern=re.compile(r"^Severity: (?P<value>.+)$"),
        template="Severity: {value}",
        translate_fields=frozenset(),  # value is a severity level tag; re-inserted verbatim
    ),
    Template(
        pattern=re.compile(r"^Proposed repair \(risk: (?P<level>\w+), (?P<count>\d+) change\(s\)\)$"),
        template="Proposed repair (risk: {level}, {count} change(s))",
        translate_fields=frozenset(),  # level/count are technical values; re-inserted verbatim
    ),
    Template(
        pattern=re.compile(r"^Model changed to (?P<name>.*)$", re.DOTALL),
        template="Model changed to {name}",
        translate_fields=frozenset(),  # name is a model identifier; re-inserted verbatim
    ),
]


def match_template(value: str) -> tuple[Template, dict[str, str]] | None:
    """Return (Template, captured_groups) for the first matching template, else None."""
    for tpl in TEMPLATES:
        m = tpl.pattern.match(value)
        if m is not None:
            return tpl, m.groupdict()
    return None
