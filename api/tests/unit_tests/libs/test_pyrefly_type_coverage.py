import json

from libs.pyrefly_type_coverage import (
    CoverageSummary,
    format_comparison_markdown,
    format_summary_markdown,
    parse_summary,
)


def _make_report(summary: dict) -> str:
    return json.dumps({"module_reports": [], "summary": summary})


_SAMPLE_SUMMARY: dict = {
    "n_modules": 100,
    "n_typable": 1000,
    "n_typed": 400,
    "n_any": 50,
    "n_untyped": 550,
    "coverage": 45.0,
    "strict_coverage": 40.0,
    "n_functions": 200,
    "n_methods": 300,
    "n_function_params": 150,
    "n_method_params": 250,
    "n_classes": 80,
    "n_attrs": 40,
    "n_properties": 20,
    "n_type_ignores": 10,
}


def _make_summary(
    *,
    n_modules: int = 100,
    n_typable: int = 1000,
    n_typed: int = 400,
    n_any: int = 50,
    n_untyped: int = 550,
    coverage: float = 45.0,
    strict_coverage: float = 40.0,
) -> CoverageSummary:
    return {
        "n_modules": n_modules,
        "n_typable": n_typable,
        "n_typed": n_typed,
        "n_any": n_any,
        "n_untyped": n_untyped,
        "coverage": coverage,
        "strict_coverage": strict_coverage,
    }


def test_parse_summary_extracts_fields() -> None:
    report_json = _make_report(_SAMPLE_SUMMARY)

    result = parse_summary(report_json)

    assert result["n_modules"] == 100
    assert result["n_typable"] == 1000
    assert result["n_typed"] == 400
    assert result["n_any"] == 50
    assert result["n_untyped"] == 550
    assert result["coverage"] == 45.0
    assert result["strict_coverage"] == 40.0


def test_parse_summary_handles_empty_input() -> None:
    assert parse_summary("")["n_modules"] == 0
    assert parse_summary("   ")["n_modules"] == 0


def test_parse_summary_handles_invalid_json() -> None:
    assert parse_summary("not json")["n_modules"] == 0


def test_parse_summary_handles_missing_summary_key() -> None:
    assert parse_summary(json.dumps({"other": 1}))["n_modules"] == 0


def test_parse_summary_handles_incomplete_summary() -> None:
    partial = json.dumps({"summary": {"n_modules": 5}})
    assert parse_summary(partial)["n_modules"] == 0


def test_format_summary_markdown_contains_key_metrics() -> None:
    summary = _make_summary()

    result = format_summary_markdown(summary)

    assert "**Type coverage**" in result
    assert "45.00%" in result
    assert "40.00%" in result
    assert "| Modules | 100 |" in result


def test_format_comparison_markdown_shows_positive_delta() -> None:
    base = _make_summary()
    pr = _make_summary(
        n_modules=101,
        n_typable=1010,
        n_typed=420,
        n_untyped=540,
        coverage=46.53,
        strict_coverage=41.58,
    )

    result = format_comparison_markdown(base, pr)

    assert "| Base | PR | Delta |" in result
    assert "+1.53%" in result
    assert "+1.58%" in result
    assert "+20" in result


def test_format_comparison_markdown_shows_negative_delta() -> None:
    base = _make_summary()
    pr = _make_summary(
        n_typed=390,
        n_any=60,
        coverage=44.0,
        strict_coverage=39.0,
    )

    result = format_comparison_markdown(base, pr)

    assert "-1.00%" in result
    assert "-10" in result


def test_format_comparison_markdown_shows_zero_delta() -> None:
    summary = _make_summary()

    result = format_comparison_markdown(summary, summary)

    assert "0.00%" in result
    assert "| 0 |" in result
