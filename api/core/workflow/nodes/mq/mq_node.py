

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.mq.entities import MqNodeData
from core.workflow.nodes.mq.rabbitmq_client import RabbitMQClient

# 创建全局RabbitMQ客户端实例
rabbitmq_client = RabbitMQClient("dify_node")

class MqNode(BaseNode[MqNodeData]):
    _node_data_cls = MqNodeData
    _node_type = NodeType.MqNode

    def _run(self) -> NodeRunResult:
        """
        Run mq node
        :return:
        """
        print("go go go execute execute execute")
        print("ddd:", self.node_data)
        node_inputs: dict[str, list] = {"conditions": []}

        newMessage = self.graph_runtime_state.variable_pool.convert_template(
            self.node_data.message
        ).text
        newChannel = self.graph_runtime_state.variable_pool.convert_template(
            self.node_data.channel
        ).text
        print("new message:", newMessage)
        print("new newChannel:", newChannel)
        process_data: dict[str, list] = {"condition_results": []}

        input_conditions = []
        final_result = False

        try:
            rabbitmq_client.publish_json({
                "action": "downloadImage",
                "msg": newMessage,
                "channel": newChannel
            })
        except Exception:
            print("err")
            pass
        outputs = {"result": True, "message": 'xxx'}

        data = NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=node_inputs,
            process_data=process_data,
            edge_source_handle="false",  # Use case ID or 'default'
            outputs=outputs,
        )

        return data

