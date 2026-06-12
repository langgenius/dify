import pytest

from services.workflow_app_service import _build_workflow_log_keyword_like_values


class TestWorkflowAppLogKeywordSearch:
    @pytest.mark.parametrize(
        ("keyword", "expected"),
        [
            ("test_keyword", ["%test\\_keyword%"]),
            ("50% discount", ["%50\\% discount%"]),
        ],
    )
    def test_build_keyword_like_values_should_escape_like_wildcards(self, keyword: str, expected: list[str]) -> None:
        assert _build_workflow_log_keyword_like_values(keyword) == expected

    def test_build_keyword_like_values_should_include_json_escaped_cjk_variant(self) -> None:
        assert _build_workflow_log_keyword_like_values("您好") == [
            "%您好%",
            "%\\\\u60a8\\\\u597d%",
        ]
