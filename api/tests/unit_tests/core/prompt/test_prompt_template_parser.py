import pytest

from core.prompt.utils.prompt_template_parser import PromptTemplateParser


class TestPromptTemplateParser:
    def test_format_replaces_string_inputs(self) -> None:
        parser = PromptTemplateParser("Hi {{name}}")

        assert parser.format({"name": "Bob"}) == "Hi Bob"

    def test_format_keeps_placeholder_when_key_is_missing(self) -> None:
        parser = PromptTemplateParser("Hi {{name}}")

        assert parser.format({}, remove_template_variables=False) == "Hi {{name}}"

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (30, "You are 30 years old"),
            (1.5, "You are 1.5 years old"),
            (True, "You are True years old"),
        ],
    )
    def test_format_renders_non_string_inputs_as_text(self, value: object, expected: str) -> None:
        parser = PromptTemplateParser("You are {{age}} years old")

        assert parser.format({"age": value}) == expected

    def test_format_renders_non_string_inputs_when_template_variables_are_kept(self) -> None:
        parser = PromptTemplateParser("You are {{age}} years old")

        assert parser.format({"age": 30}, remove_template_variables=False) == "You are 30 years old"

    def test_format_escapes_template_variables_in_non_string_inputs(self) -> None:
        parser = PromptTemplateParser("Tags: {{tags}}")

        assert parser.format({"tags": ["{{name}}"]}) == "Tags: ['{name}']"
