from core.helper.code_executor.javascript.javascript_code_provider import JavascriptCodeProvider
from core.helper.code_executor.javascript.javascript_transformer import NodeJsTemplateTransformer


def test_get_runner_script():
    code = JavascriptCodeProvider.get_default_code()
    inputs = {"arg1": "hello, ", "arg2": "world!"}
    script = NodeJsTemplateTransformer.assemble_runner_script(code, inputs)
    script_lines = script.splitlines()
    code_lines = code.splitlines()
    # First line is a random anti-KPA padding comment using JS syntax
    assert script_lines[0].startswith("// ")
    # User code follows immediately after the padding line
    assert script_lines[1 : 1 + len(code_lines)] == code_lines


def test_anti_kpa_padding_is_unique():
    code = JavascriptCodeProvider.get_default_code()
    inputs = {"arg1": "a", "arg2": "b"}
    script_a = NodeJsTemplateTransformer.assemble_runner_script(code, inputs)
    script_b = NodeJsTemplateTransformer.assemble_runner_script(code, inputs)
    padding_a = script_a.splitlines()[0]
    padding_b = script_b.splitlines()[0]
    assert padding_a != padding_b, "Each assembled script must have unique random padding"
