"""The static-string catalog covers the engine's user-facing literals."""

import re

from core.dify_builder import strings


def test_plain_catalog_has_core_microcopy():
    assert "Tests passed; ready for review." in strings.PLAIN
    assert "Workflow built on the canvas." in strings.PLAIN
    assert "Test run" in strings.PLAIN
    assert "Review" in strings.PLAIN
    assert "runs" in strings.PLAIN  # stat label
    assert "errors" in strings.PLAIN  # stat label


def test_template_matches_interpolated_strings():
    m = strings.match_template("Workflow built (3 nodes)")
    assert m is not None
    tpl, groups = m
    assert groups["count"] == "3"
    assert "{count}" in tpl.template

    m2 = strings.match_template("Root cause: the model timed out")
    assert m2 is not None
    tpl2, groups2 = m2
    assert groups2["value"] == "the model timed out"
    assert "value" in tpl2.translate_fields  # prose kept (already localized by M1)


def test_template_matches_model_changed_notice():
    # The update_model action commits "Model changed to <name>" (localized in
    # the service layer, bypassing the engine _commit hook).
    m = strings.match_template("Model changed to gpt-4o")
    assert m is not None
    tpl, groups = m
    assert groups["name"] == "gpt-4o"
    assert "{name}" in tpl.template
    assert "name" not in tpl.translate_fields  # model name is an identifier; re-inserted verbatim


def test_plain_string_is_not_a_template():
    assert strings.match_template("Tests passed; ready for review.") is None


def test_catalog_covers_handler_literals():
    """Guard: every static display literal emitted by the handlers is either in
    PLAIN or matches a TEMPLATE, so new strings can't silently stay English."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[4] / "core" / "dify_builder"
    files = ["handlers_build.py", "handlers_edit.py", "handlers_fix.py"]
    # display fields whose string literals are user-facing
    field_re = re.compile(r'(?:reply_text|title|subtitle|body|label|text)=(?:f)?"([^"]+)"')
    missing = []
    for name in files:
        src = (root / name).read_text(encoding="utf-8")
        for raw in field_re.findall(src):
            # normalize an f-string sample: replace {..} with a probe the template can match
            probe = re.sub(r"\{[^}]*\}", "42", raw)
            if raw in strings.PLAIN or strings.match_template(probe) is not None:
                continue
            # technical op/id lines (e.g. "{i.op} {node_id}") are intentionally not translated
            if raw.strip().startswith("{"):
                continue
            missing.append((name, raw))
    assert not missing, f"uncatalogued user-facing literals: {missing}"


def test_the_built_headline_is_a_template_so_it_localizes():
    # "<App name> is ready" (spec N4): the frame translates, the name does not.
    matched = strings.match_template("Refund approval is ready")

    assert matched is not None
    tpl, groups = matched
    assert tpl.template == "{name} is ready"
    assert groups["name"] == "Refund approval"


def test_the_built_headline_template_yields_to_more_specific_ones():
    # It matches almost anything, so it must be the last resort, not the first.
    tpl, groups = strings.match_template("Workflow built (3 nodes)")

    assert "{count}" in tpl.template
    assert groups["count"] == "3"


def test_the_refused_edit_copy_names_affordances_that_exist():
    """The gate's card used to say "Adjust it and approve again" while approve
    was the only control it had (triage edit-branch-failure-2026-09-22). The
    replacement names the three buttons the gate now renders, and -- like every
    engine literal -- has to be in the catalog to be localizable."""
    for text in (
        "I didn't apply the change: the workflow would fail before its first node. "
        "Continue adjusting to change the rules, approve again, or discard the plan.",
        "I couldn't apply the change -- see the error above. "
        "Continue adjusting to change the rules, approve again, or discard the plan.",
    ):
        assert text in strings.PLAIN

    stale = [s for s in strings.PLAIN if "Adjust it and approve again" in s]
    assert stale == []
