from typing import Optional

from core.workflow.nodes.base_node import BaseNode


class TemplateTransformNode(BaseNode):
    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        return {
            "type": "template-transform",
            "config": {
                "variables": [
                    {
                        "variable": "arg1",
                        "value_selector": []
                    }
                ],
                "template": "{{ arg1 }}"
            }
        }
