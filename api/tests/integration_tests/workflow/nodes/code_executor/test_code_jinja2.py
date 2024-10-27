import base64

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.helper.code_executor.jinja2.jinja2_transformer import Jinja2TemplateTransformer

CODE_LANGUAGE = CodeLanguage.JINJA2


def test_jinja2():
    template = "Hello {{template}}"
    inputs = base64.b64encode(b'{"template": "World"}').decode("utf-8")
    code = (
        Jinja2TemplateTransformer.get_runner_script()
        .replace(Jinja2TemplateTransformer._code_placeholder, template)
        .replace(Jinja2TemplateTransformer._inputs_placeholder, inputs)
    )
    result = CodeExecutor.execute_code(
        language=CODE_LANGUAGE, preload=Jinja2TemplateTransformer.get_preload_script(), code=code
    )
    assert result == "<<RESULT>>Hello World<<RESULT>>\n"


def test_jinja2_with_code_template():
    result = CodeExecutor.execute_workflow_code_template(
        language=CODE_LANGUAGE, code="Hello {{template}}", inputs={"template": "World"}
    )
    assert result == {"result": "Hello World"}


def test_jinja2_get_runner_script():
    runner_script = Jinja2TemplateTransformer.get_runner_script()
    assert runner_script.count(Jinja2TemplateTransformer._code_placeholder) == 1
    assert runner_script.count(Jinja2TemplateTransformer._inputs_placeholder) == 1
    assert runner_script.count(Jinja2TemplateTransformer._result_tag) == 2
