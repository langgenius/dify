"""Verify rendering and sandbox enforcement in generated Jinja2 scripts."""

import io
import sys

import pytest

from core.helper.code_executor.jinja2.jinja2_transformer import Jinja2TemplateTransformer

MALICIOUS_TEMPLATES = [
    pytest.param(
        "{{ lipsum.__globals__.__builtins__.__import__('os').popen('id').read() }}",
        id="lipsum_globals_builtins",
    ),
    pytest.param(
        "{{ ''.__class__.__mro__[1].__subclasses__() }}",
        id="string_class_mro",
    ),
    pytest.param(
        "{{ cycler.__init__.__globals__.os.popen('whoami').read() }}",
        id="cycler_init_globals",
    ),
    pytest.param(
        "{{ namespace.__init__.__globals__['__builtins__']['__import__']('os').system('id') }}",
        id="namespace_init_globals",
    ),
]


def _exec_scripts(runner: str, preload: str) -> str:
    """Execute preload then runner in a shared namespace, return captured stdout."""
    ns: dict[str, object] = {}
    exec(compile(preload, "<preload>", "exec"), ns)  # noqa: S102
    captured = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = captured
    try:
        exec(compile(runner, "<runner>", "exec"), ns)  # noqa: S102
    finally:
        sys.stdout = old_stdout
    return captured.getvalue()


class TestJinja2TransformCallerSandbox:
    """Test transform_caller output (runner + preload) blocks attacks and allows safe templates."""

    @pytest.mark.parametrize("malicious_template", MALICIOUS_TEMPLATES)
    def test_blocks_unsafe_template(self, malicious_template: str) -> None:
        runner, preload = Jinja2TemplateTransformer.transform_caller(malicious_template, {})
        ns: dict[str, object] = {}
        exec(compile(preload, "<preload>", "exec"), ns)  # noqa: S102
        with pytest.raises(
            Exception,
            match=(
                "(?:access to attribute '__class__' of 'str' object is unsafe\\.|"
                "access to attribute '__globals__' of 'function' object is unsafe\\.|"
                "access to attribute '__init__' of 'type' object is unsafe\\.)"
            ),
        ) as exc_info:
            exec(compile(runner, "<runner>", "exec"), ns)  # noqa: S102
        assert "unsafe" in str(exc_info.value).lower() or "security" in str(exc_info.value).lower()

    def test_renders_safe_template(self) -> None:
        """Verify that the generated scripts substitute inputs and frame the result on stdout."""
        runner, preload = Jinja2TemplateTransformer.transform_caller(
            "Hello {{ name }}, you are {{ age }} years old!",
            {"name": "Alice", "age": 30},
        )
        output = _exec_scripts(runner, preload)
        assert output == "<<RESULT>>Hello Alice, you are 30 years old!<<RESULT>>\n"

    def test_runner_script_placeholders(self) -> None:
        """Verify that the raw runner has a template slot, an inputs slot, and two result tags."""
        runner = Jinja2TemplateTransformer.get_runner_script()
        assert runner.count(Jinja2TemplateTransformer._template_b64_placeholder) == 1
        assert runner.count(Jinja2TemplateTransformer._inputs_placeholder) == 1
        assert runner.count(Jinja2TemplateTransformer._result_tag) == 2

    def test_renders_template_with_special_characters(self) -> None:
        """Render quotes and multiline textarea inputs through the generated script (#26818)."""
        template = """<html>
<body>
    <input value="{{ task.get('Task ID', '') }}"/>
    <textarea>{{ task.get('Issues', 'No issues reported') }}</textarea>
    <p>Status: "{{ status }}"</p>
    <pre>'''code block'''</pre>
</body>
</html>"""
        inputs = {"task": {"Task ID": "TASK-123", "Issues": "Line 1\nLine 2\nLine 3"}, "status": "completed"}

        runner, preload = Jinja2TemplateTransformer.transform_caller(template, inputs)
        output = Jinja2TemplateTransformer.transform_response(_exec_scripts(runner, preload))["result"]

        assert 'value="TASK-123"' in output
        assert "<textarea>Line 1\nLine 2\nLine 3</textarea>" in output
        assert 'Status: "completed"' in output
        assert "'''code block'''" in output

    def test_scripts_use_sandboxed_environment(self) -> None:
        runner, preload = Jinja2TemplateTransformer.transform_caller("{{ x }}", {"x": 1})
        assert "SandboxedEnvironment" in runner
        assert "SandboxedEnvironment" in preload
