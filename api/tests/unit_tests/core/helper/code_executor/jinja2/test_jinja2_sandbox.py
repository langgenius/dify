"""Verify that Jinja2 transform_caller scripts block unsafe template attacks via SandboxedEnvironment."""

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
    ns: dict = {}
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
        ns: dict = {}
        exec(compile(preload, "<preload>", "exec"), ns)  # noqa: S102
        with pytest.raises(Exception) as exc_info:
            exec(compile(runner, "<runner>", "exec"), ns)  # noqa: S102
        assert "unsafe" in str(exc_info.value).lower() or "security" in str(exc_info.value).lower()

    def test_renders_safe_template(self) -> None:
        runner, preload = Jinja2TemplateTransformer.transform_caller(
            "Hello {{ name }}, you are {{ age }} years old!",
            {"name": "Alice", "age": 30},
        )
        output = _exec_scripts(runner, preload)
        assert "Hello Alice, you are 30 years old!" in output

    def test_scripts_use_sandboxed_environment(self) -> None:
        runner, preload = Jinja2TemplateTransformer.transform_caller("{{ x }}", {"x": 1})
        assert "SandboxedEnvironment" in runner
        assert "SandboxedEnvironment" in preload
