from libs.text_search import matches


def test_matches_ignores_case_and_none() -> None:
    assert matches("Git", None, "github")
    assert not matches("slack", "github", None)


def test_no_text_matches_every_row() -> None:
    assert matches("", None)
    assert matches(None, "github")
