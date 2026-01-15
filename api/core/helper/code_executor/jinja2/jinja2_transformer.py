from collections.abc import Mapping
from textwrap import dedent
from typing import Any

from core.helper.code_executor.template_transformer import TemplateTransformer


class Jinja2TemplateTransformer(TemplateTransformer):
    # Use separate placeholder for base64-encoded template to avoid confusion
    _template_b64_placeholder: str = "{{template_b64}}"

    @classmethod
    def transform_response(cls, response: str):
        """
        Transform response to dict
        :param response: response
        :return:
        """
        return {"result": cls.extract_result_str_from_response(response)}

    @classmethod
    def assemble_runner_script(cls, code: str, inputs: Mapping[str, Any]) -> str:
        """
        Override base class to use base64 encoding for template code.
        This prevents issues with special characters (quotes, newlines) in templates
        breaking the generated Python script. Fixes #26818.
        """
        script = cls.get_runner_script()
        # Encode template as base64 to safely embed any content including quotes
        code_b64 = cls.serialize_code(code)
        script = script.replace(cls._template_b64_placeholder, code_b64)
        inputs_str = cls.serialize_inputs(inputs)
        script = script.replace(cls._inputs_placeholder, inputs_str)
        return script

    @classmethod
    def get_runner_script(cls) -> str:
        runner_script = dedent(f"""
            import jinja2
            import json
            from base64 import b64decode

            # declare main function
            def main(**inputs):
                # Decode base64-encoded template to handle special characters safely
                template_code = b64decode('{cls._template_b64_placeholder}').decode('utf-8')
                template = jinja2.Template(template_code)
                return template.render(**inputs)

            # decode and prepare input dict
            inputs_obj = json.loads(b64decode('{cls._inputs_placeholder}').decode('utf-8'))

            # execute main function
            output = main(**inputs_obj)

            # convert output and print
            result = f'''<<RESULT>>{{output}}<<RESULT>>'''
            print(result)

            """)
        return runner_script

    @classmethod
    def get_preload_script(cls) -> str:
        preload_script = dedent("""
            import jinja2
            from base64 import b64decode

            def _jinja2_preload_():
                # prepare jinja2 environment, load template and render before to avoid sandbox issue
                template = jinja2.Template('{{s}}')
                template.render(s='a')

            if __name__ == '__main__':
                _jinja2_preload_()

            """)

        return preload_script
