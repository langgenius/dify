from textwrap import dedent

from core.helper.code_executor.template_transformer import TemplateTransformer


class NodeJsTemplateTransformer(TemplateTransformer):
    @classmethod
    def get_runner_script(cls) -> str:
        runner_script = dedent(
            f"""
            // declare main function
            {cls._code_placeholder}

            try {{
                // decode and prepare input object
                var inputs_obj = JSON.parse(Buffer.from('{cls._inputs_placeholder}', 'base64').toString('utf-8'))

                // Preprocess inputs to handle number precision issues
                function preprocessInputs(obj) {{
                    if (typeof obj === 'object' && obj !== null) {{
                        for (var key in obj) {{
                            if (obj.hasOwnProperty(key)) {{
                                if (typeof obj[key] === 'string') {{
                                    // Try to parse string as number if it looks like a number
                                    var num = parseFloat(obj[key]);
                                    if (!isNaN(num) && obj[key].trim() === num.toString()) {{
                                        obj[key] = num;
                                    }}
                                }} else if (typeof obj[key] === 'object') {{
                                    preprocessInputs(obj[key]);
                                }}
                            }}
                        }}
                    }}
                    return obj;
                }}
                
                // Preprocess inputs
                inputs_obj = preprocessInputs(inputs_obj);

                // execute main function
                var output_obj = main(inputs_obj)

                // Handle precision numbers properly in JSON.stringify
                var output_json = JSON.stringify(output_obj, function(key, value) {{
                    // Ensure numbers are properly serialized
                    if (typeof value === 'number') {{
                        // Handle very small numbers that might cause precision issues
                        if (Math.abs(value) < 1e-1 && Math.abs(value) > 0) {{
                            // Convert to string to preserve precision
                            return value.toString();
                        }}
                    }}
                    return value;
                }})
                
                var result = `<<RESULT>>${{output_json}}<<RESULT>>`
                console.log(result)
            }} catch (error) {{
                console.error('JavaScript execution error:', error.message)
                // Provide more detailed error information
                var errorResult = `<<RESULT>>{{"error": "JavaScript execution failed: " + error.message}}<<RESULT>>`
                console.log(errorResult)
            }}
            """
        )
        return runner_script