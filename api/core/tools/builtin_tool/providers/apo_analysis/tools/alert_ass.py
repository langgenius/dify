import json
from collections.abc import Generator
from typing import Any, Optional

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class AlertAssociateTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        metric = tool_parameters.get('topology_data')
        topology_data = json.loads(metric)['data']
        alert_data = json.loads(tool_parameters.get('alert_data'))['data']
        alert = self.process_alert(alert_data)
        topology = self.process_topology(topology_data, alert)

        # res = json.dumps({
        #     "type": 'llm',
        #     "display": False,
        #     "data": topology
        # }, ensure_ascii=False)
        yield self.create_text_message(topology)
    
    def _summary_delta_event(self, delta_data: list, stats: dict):
        for event in delta_data:
            service = event['serviceName']
            endpoint = event['endpoint']
            anormal_status = event['anormalStatus']
            anormal_type = event['anormalType']
            time = event['timestamp']
            p = f'{service}_#"{endpoint}"'

            if p not in stats:
                stats[p] = {}
            
            if anormal_type not in stats[p]:
                stats[p][anormal_type] = {
                    "add": 0,
                    "duplicate": 0,
                    "resolve": 0,
                    "keep": 0,
                    "lastTime": time,
                    "firstTime": time
            }

            if time < stats[p][anormal_type]["firstTime"]:
                stats[p][anormal_type]["firstTime"] = time
    
            if time > stats[p][anormal_type]["lastTime"]:
                stats[p][anormal_type]["lastTime"] = time

            match anormal_status:
                case "startFiring":
                    stats[p][anormal_type]["add"] += 1
                case "resolved":
                    stats[p][anormal_type]["resolve"] += 1
                    if "resolveTime" not in stats[p][anormal_type]:
                        stats[p][anormal_type]["resolveTime"] = time
                case "updatedFiring":
                    stats[p][anormal_type]["duplicate"] += 1

    def _summary_keep_event(self, json_data: list, stats: dict):
        for event in json_data:
            service_name = event["serviceName"]
            anormal_type = event["anormalType"]
            endpoint = event["endpoint"]
            p = service_name + '_#"' + endpoint + '"'
            stats[p][anormal_type]["keep"] += 1

    def process_alert(self, alert_data: dict) -> dict:
        stats = {}
        json_data = alert_data["deltaAnormalEvents"]
        self._summary_delta_event(json_data, stats)
        json_data = alert_data["finalAnormalEvents"]
        self._summary_keep_event(json_data, stats)
        return stats
    
    def _build_tree(self, node: str, depth=0, relation_dict={}, list=[], alert_data={}):
        indent = "  " * depth
        text = ""
        text += f'{indent}{depth}──'

        if node in alert_data:
            alert_text = json.dumps(alert_data[node])
            text += f"{node} {alert_text}\n"
        else:
            text += f"{node}\n"

        list.append(text)
        
        if node in relation_dict:
            for child in relation_dict[node]:
                self._build_tree(child, depth + 1, relation_dict, list, alert_data)

    def process_topology(self, topology_data: dict, alert_data: dict) -> str:
        relation_dict = {}
        for relation in topology_data["childRelations"]:

            p = relation['parentService']
            c = relation['service']
            parent_node = f'{p}_#"{relation['parentEndpoint']}"'
            child_node = f'{c}_#"{relation['endpoint']}"'
    
            if parent_node not in relation_dict:
                relation_dict[parent_node] = []
    
            relation_dict[parent_node].append(child_node)

        text = [] 
        root_nodes = set(relation_dict.keys()) - {child for children in relation_dict.values() for child in children}
        for root in root_nodes:
            self._build_tree(root, 0, relation_dict, text, alert_data)
        res = "".join(text)
        return res