from typing import Optional

from core.workflow.nodes.base_node import BaseNode


class CodeNode(BaseNode):
    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        if filters and filters.get("code_language") == "javascript":
            return {
                "type": "code",
                "config": {
                    "variables": [
                        {
                            "variable": "arg1",
                            "value_selector": []
                        },
                        {
                            "variable": "arg2",
                            "value_selector": []
                        }
                    ],
                    "code_language": "javascript",
                    "code": "async function main(arg1, arg2) {\n    return new Promise((resolve, reject) => {"
                            "\n    	if (true) {\n	        resolve({\n	            \"result\": arg1 + arg2"
                            "\n        	});\n        } else {\n        	reject(\"e\");\n    }\n    });\n}",
                    "outputs": [
                        {
                            "variable": "result",
                            "variable_type": "number"
                        }
                    ]
                }
            }

        return {
            "type": "code",
            "config": {
                "variables": [
                    {
                        "variable": "arg1",
                        "value_selector": []
                    },
                    {
                        "variable": "arg2",
                        "value_selector": []
                    }
                ],
                "code_language": "python3",
                "code": "def main(\n    arg1: int,\n    arg2: int,\n) -> int:\n    return {\n        \"result\": arg1 "
                        "+ arg2\n    }",
                "outputs": [
                    {
                        "variable": "result",
                        "variable_type": "number"
                    }
                ]
            }
        }
