from textwrap import dedent

from core.helper.code_executor.template_transformer import TemplateTransformer


class NodeJsTemplateTransformer(TemplateTransformer):
    @classmethod
    def get_runner_script(cls) -> str:
        runner_script = dedent(
            f"""
            // declare main function
            {cls._code_placeholder}

            // decode and prepare input object
            var inputs_obj = JSON.parse(Buffer.from('{cls._inputs_placeholder}', 'base64').toString('utf-8'))

            // execute main function
            var output_obj = main(inputs_obj)

            // convert output to json and print
            var output_json = JSON.stringify(output_obj)
            var result = `<<RESULT>>${{output_json}}<<RESULT>>`
            console.log(result)
            """
        )
        return runner_script
