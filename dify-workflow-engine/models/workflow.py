class Workflow:
    def __init__(self, tenant_id, app_id, id, graph_dict):
        self.tenant_id = tenant_id
        self.app_id = app_id
        self.id = id
        self.graph_dict = graph_dict

    def get_node_config_by_id(self, node_id):
        for node in self.graph_dict.get("nodes", []):
            if node["id"] == node_id:
                return node
        return {}
