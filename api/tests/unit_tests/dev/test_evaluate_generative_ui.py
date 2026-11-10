"""Test evaluation boundaries without calling a model or grading semantics."""

import json
from pathlib import Path
from typing import Literal
from uuid import uuid4

import pytest

from dev.evaluate_generative_ui import (
    DEFAULT_CASES,
    EvaluationReport,
    QualityCase,
    assess_response,
    build_prompt,
    load_cases,
    main,
    run_evaluation,
)
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)
from tests.helpers.unit.core.model_fixtures import make_model_instance


@pytest.mark.parametrize(
    ("policy", "response", "policy_passed", "fences_complete"),
    [
        ("forbidden", "There are no records to analyze.", True, True),
        ("required", "Only a conclusion.", False, True),
        ("optional", "Only a conclusion.", True, True),
        ("required", 'Conclusion\n```openui\nroot = Stack([Text("data")])\n```\nRecommendation', True, True),
        ("forbidden", '```openui\nroot = Stack([Text("data")])\n```', False, True),
        ("required", "```openui\nroot = Stack([", True, False),
    ],
)
def test_transport_checks_do_not_automatically_grade_semantic_rubrics(
    policy: Literal["required", "forbidden", "optional"],
    response: str,
    policy_passed: bool,
    fences_complete: bool,
) -> None:
    case = QualityCase(id="comparison", prompt="Compare the data", ui=policy, rubric=["Values are accurate"])

    result = assess_response(case, response, 1.5)

    assert result.automated_checks is not None
    assert result.automated_checks.ui_policy == policy_passed
    assert result.automated_checks.fences_complete == fences_complete
    assert result.automated_checks.passed == (policy_passed and fences_complete)
    assert result.raw_response == response
    assert result.elapsed_seconds == 1.5
    assert result.semantic_review == "pending"
    assert result.case.rubric == ["Values are accurate"]


def test_response_report_preserves_order_offsets_without_claiming_dsl_validity() -> None:
    case = QualityCase(id="comparison", prompt="Compare", ui="required", rubric=["Readable chart"])
    response = "Conclusion\n```openui\nNotARegisteredComponent()\n```\nRecommendation"

    result = assess_response(case, response, 0.3)

    assert result.prose == "Conclusion\nRecommendation"
    assert result.content_blocks[0].text_offset == len("Conclusion\n")
    assert result.content_blocks[0].source == "NotARegisteredComponent()\n"
    assert result.automated_checks is not None
    assert result.automated_checks.passed
    assert result.semantic_review == "pending"


def test_dataset_contains_distinct_cases_and_follow_up_prompt_keeps_ui_history() -> None:
    cases = load_cases(DEFAULT_CASES, [])
    assert len(cases) == 6
    follow_up = load_cases(DEFAULT_CASES, ["follow-up-ui-fact"])[0]

    messages = build_prompt(follow_up, "OpenUI system prompt")

    assert [type(message) for message in messages] == [
        SystemPromptMessage,
        UserPromptMessage,
        AssistantPromptMessage,
        UserPromptMessage,
    ]
    assert messages[0].content == "OpenUI system prompt"
    assert messages[2].content == follow_up.history[1].content
    assert "value: 48" in messages[2].get_text_content()
    assert messages[-1].content == follow_up.prompt


def test_case_selection_rejects_unknown_ids() -> None:
    with pytest.raises(ValueError, match="Unknown evaluation cases: typo"):
        load_cases(DEFAULT_CASES, ["typo"])


def test_dataset_rejects_duplicate_case_ids(tmp_path: Path) -> None:
    case = {"id": "duplicate", "prompt": "Hello", "ui": "forbidden", "rubric": ["No UI"]}
    path = tmp_path / "cases.json"
    path.write_text(json.dumps([case, case]))

    with pytest.raises(ValueError, match="IDs must be unique"):
        load_cases(path, [])


def test_evaluation_persists_remaining_cases_after_provider_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = make_model_instance(provider="langgenius/openai/openai", model="test-model")
    cases = [
        QualityCase(id="failed", prompt="Fail this call", ui="optional", rubric=[]),
        QualityCase(id="complete", prompt="Say hello", ui="forbidden", rubric=[]),
    ]

    def invoke(*, prompt_messages: list[PromptMessage], stream: bool, **_kwargs: object) -> LLMResult:
        assert not stream
        if prompt_messages[-1].get_text_content() == cases[0].prompt:
            raise RuntimeError("private provider error details")
        return LLMResult(
            model=model.model_name, message=AssistantPromptMessage(content="Hello."), usage=LLMUsage.empty_usage()
        )

    monkeypatch.setattr(model.model_type_instance, "invoke", invoke)
    output = tmp_path / "reports" / "evaluation.json"

    report = run_evaluation(uuid4(), model, cases, output)

    contents = output.read_text(encoding="utf-8")
    assert EvaluationReport.model_validate_json(contents) == report
    assert "private provider error details" not in contents
    failed, complete = report.results
    assert failed.case == cases[0]
    assert failed.error_type == "RuntimeError"
    assert failed.automated_checks is None
    assert complete.case == cases[1]
    assert complete.prose == "Hello."
    assert complete.automated_checks is not None
    assert complete.automated_checks.passed


def test_cli_requires_provider_and_model_together_before_runtime_setup(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as error:
        main(
            [
                "--app-id",
                "9aca58d7-f9fc-4843-ad02-0cba9b9e1a31",
                "--output",
                "/tmp/openui-evaluation.json",
                "--provider",
                "configured-provider",
            ]
        )

    assert error.value.code == 2
    assert "--provider and --model must be supplied together" in capsys.readouterr().err
