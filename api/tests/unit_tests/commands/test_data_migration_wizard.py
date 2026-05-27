from commands.data_migration import parse_index_selection


def test_parse_index_selection_supports_all():
    assert parse_index_selection("all", ["a", "b", "c"]) == ["a", "b", "c"]


def test_parse_index_selection_supports_comma_indexes():
    assert parse_index_selection("1, 3", ["a", "b", "c"]) == ["a", "c"]
