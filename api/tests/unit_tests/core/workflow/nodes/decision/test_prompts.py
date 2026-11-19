"""Prompt construction for the ``decision`` node's language-model mode."""

from core.workflow.nodes.decision.entities import DecisionExtra, Outcome
from core.workflow.nodes.decision.prompts import (
    DECISION_INSTRUCTION,
    OUTPUT_CONTRACT,
    build_extras_section,
    build_glossary_section,
    build_inputs_section,
    build_outcomes_section,
    build_prompt_messages,
)
from graphon.model_runtime.entities.message_entities import PromptMessageRole


class TestSections:
    def test_glossary_section_is_omitted_when_blank(self) -> None:
        assert build_glossary_section("") == ""
        assert build_glossary_section("   \n ") == ""

    def test_glossary_section_keeps_the_text(self) -> None:
        assert build_glossary_section("  Refund means money back.  ") == "### Glossary\nRefund means money back."

    def test_outcomes_section_lists_id_label_and_when(self) -> None:
        section = build_outcomes_section(
            [Outcome(id="refund", label="Refund", when="The user wants a refund")],
        )

        assert section.startswith("### Outcomes")
        assert '"id": "refund"' in section
        assert '"label": "Refund"' in section
        assert '"when": "The user wants a refund"' in section

    def test_extras_section_only_lists_model_written_extras(self) -> None:
        section = build_extras_section(
            [
                DecisionExtra(name="urgency", from_="fixed", values={"refund": "normal"}),
                DecisionExtra(name="summary", from_="model", hint="One sentence"),
            ]
        )

        assert '"summary"' in section
        assert "One sentence" in section
        assert "urgency" not in section

    def test_extras_section_is_omitted_without_model_extras(self) -> None:
        assert build_extras_section([]) == ""
        assert build_extras_section([DecisionExtra(name="urgency", from_="fixed", values={})]) == ""

    def test_inputs_section_renders_the_values(self) -> None:
        assert build_inputs_section({"message": "I want a refund"}) == (
            '### Inputs\n{\n  "message": "I want a refund"\n}'
        )


class TestBuildPromptMessages:
    def test_instruction_is_the_system_message_and_sections_the_user_message(self) -> None:
        messages = build_prompt_messages(
            instruction="Do the thing.",
            glossary="",
            outcomes=[Outcome(id="a", label="A", when="w")],
            extras=[],
            inputs={"message": "hi"},
        )

        assert [message.role for message in messages] == [PromptMessageRole.SYSTEM, PromptMessageRole.USER]
        assert messages[0].get_text_content() == "Do the thing."
        user_text = messages[1].get_text_content()
        assert "### Outcomes" in user_text
        assert "### Inputs" in user_text
        assert OUTPUT_CONTRACT in user_text
        assert "### Glossary" not in user_text

    def test_glossary_is_appended_when_present(self) -> None:
        messages = build_prompt_messages(
            instruction=DECISION_INSTRUCTION,
            glossary="Refund means money back.",
            outcomes=[Outcome(id="a", label="A", when="w")],
            extras=[],
            inputs={},
        )

        assert "### Glossary" in messages[1].get_text_content()
