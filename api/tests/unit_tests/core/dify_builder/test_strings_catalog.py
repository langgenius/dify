"""The static-string catalog covers the engine's user-facing literals."""

import re

from core.dify_builder import strings


def test_plain_catalog_has_core_microcopy():
    assert "Tests passed; ready for review." in strings.PLAIN
    assert "Workflow built on the canvas." in strings.PLAIN
    assert "Test run" in strings.PLAIN
    assert "Review" in strings.PLAIN
    assert "runs" in strings.PLAIN and "errors" in strings.PLAIN  # stat labels


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
