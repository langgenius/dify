import importlib

import pytest


def _load_human_input_package():
    try:
        return importlib.import_module("core.workflow.human_input")
    except ModuleNotFoundError as exc:
        pytest.fail(f"expected Dify-owned human input package at 'core.workflow.human_input': {exc}")


class _FakeRenderedTemplate:
    def __init__(self, markdown: str) -> None:
        self.markdown = markdown


class _FakeVariablePool:
    def convert_template(self, template: str) -> _FakeRenderedTemplate:
        assert template == "Hello {{#start.user#}} and {{#$output.answer#}}"
        return _FakeRenderedTemplate("Hello Alice and {{#$output.answer#}}")


def test_render_form_content_before_submission_renders_runtime_variables_but_preserves_outputs() -> None:
    module = _load_human_input_package()

    rendered = module.render_form_content_before_submission(
        form_content="Hello {{#start.user#}} and {{#$output.answer#}}",
        variable_pool=_FakeVariablePool(),
    )

    assert rendered == "Hello Alice and {{#$output.answer#}}"


def test_human_input_node_data_preserves_full_input_selector_mapping() -> None:
    module = _load_human_input_package()
    node_data = module.HumanInputNodeData(
        title="Collect Input",
        form_content="Greeting {{#start.user#}} / {{#$output.answer#}}",
        inputs=[
            module.ParagraphInputConfig(
                output_variable_name="answer",
                default=module.StringSource(
                    type=module.ValueSourceType.VARIABLE,
                    selector=("input", "profile", "bio"),
                ),
            )
        ],
    )

    mapping = node_data.extract_variable_selector_to_variable_mapping("human-node")

    assert mapping["human-node.#start.user#"] == ["start", "user"]
    assert mapping["human-node.#input.profile.bio#"] == ["input", "profile", "bio"]
