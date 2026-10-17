from types import SimpleNamespace

import pytest
from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor
from core.workflow.template_rendering import CodeExecutorJinja2TemplateRenderer
from graphon.nodes.code.entities import CodeLanguage
from graphon.template_rendering import TemplateRenderError
from services.dify_builder.native_testing.control import NativePolicyStop

from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import REF


def test_explicit_executor_owns_template_without_ordinary_fallback(monkeypatch):
    observed = []

    def execute(**kwargs):
        observed.append(kwargs)
        return {"result": "rendered"}

    monkeypatch.setattr(
        CodeExecutor,
        "execute_workflow_code_template",
        lambda **kw: pytest.fail("ordinary fallback"),
    )
    renderer = CodeExecutorJinja2TemplateRenderer(
        executor=SimpleNamespace(execute=execute)
    )
    assert renderer.render_template("{{ secret }}", {"secret": "private"}) == "rendered"
    assert observed == [
        {
            "language": CodeLanguage.JINJA2,
            "code": "{{ secret }}",
            "inputs": {"secret": "private"},
        }
    ]


def test_default_renderer_preserves_existing_executor_call(monkeypatch):
    seen = []

    def execute(**kwargs):
        seen.append(kwargs)
        return {"result": "ordinary"}

    monkeypatch.setattr(CodeExecutor, "execute_workflow_code_template", execute)
    assert (
        CodeExecutorJinja2TemplateRenderer().render_template("literal", {})
        == "ordinary"
    )
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
    error,
):
    def execute(**kwargs):
        raise error

    renderer = CodeExecutorJinja2TemplateRenderer(
        executor=SimpleNamespace(execute=execute)
    )
    if type(error) is CodeExecutionError:
        with pytest.raises(TemplateRenderError, match="fixed"):
            renderer.render_template("x", {})
    else:
        with pytest.raises(type(error)) as caught:
            renderer.render_template("x", {})
        assert caught.value is error


def test_explicit_renderer_retains_native_string_result_validation():
    renderer = CodeExecutorJinja2TemplateRenderer(
        executor=SimpleNamespace(execute=lambda **kw: {"result": 3})
    )
    with pytest.raises(TemplateRenderError, match="must be a string"):
        renderer.render_template("x", {})
