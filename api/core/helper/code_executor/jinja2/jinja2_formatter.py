from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage


class Jinja2Formatter:
    @classmethod
    def format(cls, template: str, inputs: dict) -> str:
        """
        Format template
        :param template: template
        :param inputs: inputs
        :return:
        """
        result = CodeExecutor.execute_workflow_code_template(language=CodeLanguage.JINJA2, code=template, inputs=inputs)

        return result["result"]
