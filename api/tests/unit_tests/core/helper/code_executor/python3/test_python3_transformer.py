from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider
from core.helper.code_executor.python3.python3_transformer import Python3TemplateTransformer


def test_get_runner_script():
    code = Python3CodeProvider.get_default_code()
    inputs = {"arg1": "hello, ", "arg2": "world!"}
    script = Python3TemplateTransformer.assemble_runner_script(code, inputs)
    script_lines = script.splitlines()
    code_lines = code.splitlines()
    # Check that the first lines of script are exactly the same as code
    assert script_lines[: len(code_lines)] == code_lines


def test_inputs_placeholder_inside_user_code_is_preserved():
    # User code contains a string literal with `{{inputs}}` — it must survive
    # the runner assembly untouched (regression for #43435: the inputs
    # substitution used to run after code insertion and corrupted the literal).
    code = "def main():\n    return {'literal': '{{inputs}}', 'inputs': {}}"
    inputs = {"arg1": "hello"}
    script = Python3TemplateTransformer.assemble_runner_script(code, inputs)
    assert "return {'literal': '{{inputs}}', 'inputs': {}}" in script
    # The real placeholder in the runner preamble is still substituted once.
    assert script.count("b64decode('") == 1
    assert "b64decode('" in script
