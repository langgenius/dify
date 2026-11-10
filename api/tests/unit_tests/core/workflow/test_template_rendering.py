from typing import Never

import pytest

from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor
from core.workflow.template_rendering import CodeExecutorJinja2TemplateRenderer
from graphon.nodes.code.entities import CodeLanguage
from graphon.template_rendering import TemplateRenderError
from services.dify_builder.native_testing.control import NativePolicyStop
from services.workflow_runtime.node_factory import DefaultWorkflowCodeExecutor
from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import REF


def test_explicit_executor_owns_template_without_ordinary_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    observed = []

    def execute(**kwargs: object) -> dict[str, str]:
        observed.append(kwargs)
        return {"result": "rendered"}

    monkeypatch.setattr(
        CodeExecutor,
        "execute_workflow_code_template",
        lambda **_kw: pytest.fail("ordinary fallback"),
    )
    executor = DefaultWorkflowCodeExecutor()
    monkeypatch.setattr(executor, "execute", execute)
    renderer = CodeExecutorJinja2TemplateRenderer(executor=executor)
    assert renderer.render_template("{{ secret }}", {"secret": "private"}) == "rendered"
    assert observed == [
        {
            "language": CodeLanguage.JINJA2,
            "code": "{{ secret }}",
            "inputs": {"secret": "private"},
        }
    ]


def test_default_renderer_preserves_existing_executor_call(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = []

    def execute(**kwargs: object) -> dict[str, str]:
        seen.append(kwargs)
        return {"result": "ordinary"}

    monkeypatch.setattr(CodeExecutor, "execute_workflow_code_template", execute)
    assert CodeExecutorJinja2TemplateRenderer().render_template("literal", {}) == "ordinary"
    assert seen == [{"language": CodeLanguage.JINJA2, "code": "literal", "inputs": {}}]


@pytest.mark.parametrize(
    "error",
    [
        CodeExecutionError("fixed"),
        ValueError("keep identity"),
        NativePolicyStop(ref=REF, reason_code="test_stop"),
    ],
)
def test_explicit_renderer_translates_only_code_error_and_preserves_native_control(
    error: Exception,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def execute(**kwargs: object) -> Never:
        del kwargs
        raise error

    executor = DefaultWorkflowCodeExecutor()
    monkeypatch.setattr(executor, "execute", execute)
    renderer = CodeExecutorJinja2TemplateRenderer(executor=executor)
    if type(error) is CodeExecutionError:
        with pytest.raises(TemplateRenderError, match="fixed"):
            renderer.render_template("x", {})
    else:
        with pytest.raises(type(error)) as caught:
            renderer.render_template("x", {})
        assert caught.value is error


def test_explicit_renderer_retains_native_string_result_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    executor = DefaultWorkflowCodeExecutor()
    monkeypatch.setattr(executor, "execute", lambda **_kw: {"result": 3})
    renderer = CodeExecutorJinja2TemplateRenderer(executor=executor)
    with pytest.raises(TemplateRenderError, match="must be a string"):
        renderer.render_template("x", {})
