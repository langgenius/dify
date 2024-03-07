from typing import Optional, cast

from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.llm.entities import LLMNodeData


class LLMNode(BaseNode):
    _node_data_cls = LLMNodeData
    node_type = NodeType.LLM

    def _run(self, variable_pool: Optional[VariablePool] = None,
             run_args: Optional[dict] = None) -> NodeRunResult:
        """
        Run node
        :param variable_pool: variable pool
        :param run_args: run args
        :return:
        """
        node_data = self.node_data
        node_data = cast(self._node_data_cls, node_data)

        pass

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        return {
            "type": "llm",
            "config": {
                "prompt_templates": {
                    "chat_model": {
                        "prompts": [
                            {
                                "role": "system",
                                "text": "You are a helpful AI assistant."
                            }
                        ]
                    },
                    "completion_model": {
                        "conversation_histories_role": {
                            "user_prefix": "Human",
                            "assistant_prefix": "Assistant"
                        },
                        "prompt": {
                            "text": "Here is the chat histories between human and assistant, inside "
                                    "<histories></histories> XML tags.\n\n<histories>\n{{"
                                    "#histories#}}\n</histories>\n\n\nHuman: {{#query#}}\n\nAssistant:"
                        },
                        "stop": ["Human:"]
                    }
                }
            }
        }
