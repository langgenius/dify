from textwrap import dedent

from core.helper.code_executor.template_transformer import TemplateTransformer


class Python3TemplateTransformer(TemplateTransformer):
    @classmethod
    def get_runner_script(cls) -> str:
        runner_script = dedent(f"""            {cls._code_placeholder}

            import json
            from base64 import b64decode

            # decode and prepare input dict
            inputs_obj = json.loads(b64decode('{cls._inputs_placeholder}').decode('utf-8'))

            # execute main function
            output_obj = main(**inputs_obj)

            # convert output to json and print
            output_json = json.dumps(output_obj, indent=4)
            result = f'''<<RESULT>>{{output_json}}<<RESULT>>'''
            print(result)
            """)
        return runner_script
