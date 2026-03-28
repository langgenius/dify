import pytest

from core.llm_generator.output_parser.errors import OutputParserError
from core.llm_generator.output_parser.rule_config_generator import RuleConfigGeneratorOutputParser
from core.llm_generator.prompts import (
    RULE_CONFIG_PARAMETER_GENERATE_TEMPLATE,
    RULE_CONFIG_PROMPT_GENERATE_TEMPLATE,
    RULE_CONFIG_STATEMENT_GENERATE_TEMPLATE,
)


class TestRuleConfigGeneratorOutputParser:
    def test_get_format_instructions(self):
        parser = RuleConfigGeneratorOutputParser()
        instructions = parser.get_format_instructions()
        assert instructions == (
            RULE_CONFIG_PROMPT_GENERATE_TEMPLATE,
            RULE_CONFIG_PARAMETER_GENERATE_TEMPLATE,
            RULE_CONFIG_STATEMENT_GENERATE_TEMPLATE,
        )

    def test_parse_success(self):
        parser = RuleConfigGeneratorOutputParser()
        text = """
```json
{
    "prompt": "This is a prompt",
    "variables": ["var1", "var2"],
    "opening_statement": "Hello!"
}
```
"""
        result = parser.parse(text)
        assert result["prompt"] == "This is a prompt"
        assert result["variables"] == ["var1", "var2"]
        assert result["opening_statement"] == "Hello!"

    def test_parse_invalid_json(self):
        parser = RuleConfigGeneratorOutputParser()
        text = "invalid json"
        with pytest.raises(OutputParserError) as excinfo:
            parser.parse(text)
        assert "Parsing text" in str(excinfo.value)
        assert "could not find json block in the output" in str(excinfo.value)

    def test_parse_missing_keys(self):
        parser = RuleConfigGeneratorOutputParser()
        text = """
```json
{
    "prompt": "This is a prompt",
    "variables": ["var1", "var2"]
}
```
"""
        with pytest.raises(OutputParserError) as excinfo:
            parser.parse(text)
        assert "expected key `opening_statement` to be present" in str(excinfo.value)

    def test_parse_wrong_type_prompt(self):
        parser = RuleConfigGeneratorOutputParser()
        text = """
```json
{
    "prompt": 123,
    "variables": ["var1", "var2"],
    "opening_statement": "Hello!"
}
```
"""
        with pytest.raises(OutputParserError) as excinfo:
            parser.parse(text)
        assert "Expected 'prompt' to be a string" in str(excinfo.value)

    def test_parse_wrong_type_variables(self):
        parser = RuleConfigGeneratorOutputParser()
        text = """
```json
{
    "prompt": "This is a prompt",
    "variables": "not a list",
    "opening_statement": "Hello!"
}
```
"""
        with pytest.raises(OutputParserError) as excinfo:
            parser.parse(text)
        assert "Expected 'variables' to be a list" in str(excinfo.value)

    def test_parse_wrong_type_opening_statement(self):
        parser = RuleConfigGeneratorOutputParser()
        text = """
```json
{
    "prompt": "This is a prompt",
    "variables": ["var1", "var2"],
    "opening_statement": 123
}
```
"""
        with pytest.raises(OutputParserError) as excinfo:
            parser.parse(text)
        assert "Expected 'opening_statement' to be a str" in str(excinfo.value)
