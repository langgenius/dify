import json
from collections.abc import Generator
from typing import Any, Optional

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class RootCauseTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        invoke tools
        """
        llm_text = tool_parameters.get("text")
        node_lists, text = self._get_node_list(llm_text)
        
        yield self.create_text_message(text)
        yield self.create_json_message({'nodelists': node_lists})
    
    def _get_node_list(self, data: str) -> tuple[list, str]: 
        data = data.strip('```')
        data = data.strip('json')
        text = ""
        try:
            nodeinfo = json.loads(data)
            nodeList = []
            if "nodeName" in nodeinfo:
                service = nodeinfo["nodeName"].split('_#')[0]
                ep = nodeinfo["nodeName"].split('_#')[1]
                endpoint = ep.strip('"')
                endpoint = endpoint.strip("'")
                nodeList.append({'service': service, 'endpoint': endpoint, "isRoot": True})
                text = text + f'造成根因的节点是{nodeinfo['nodeName']}\n'
    
            if "otherNodeName" in data:
                for node in nodeinfo["otherNodeName"]:
                    tmpservice = node.split('_#')[0]
                    ep = node.split('_#')[1]
                    tmpendpoint = ep.strip('"')
                    tmpendpoint = tmpendpoint.strip("'")
                    nodeList.append({'service': tmpservice, 'endpoint': tmpendpoint, "isRoot": False})
                otherstr = ",".join(nodeinfo["otherNodeName"])
                text = text + f'疑似根因节点有{otherstr}\n'
            return nodeList, text
        except Exception as e:
            return [], ""