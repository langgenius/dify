from typing import Any, Optional, cast

from configs import dify_config
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.model_manager import ModelInstance

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.llm import LLMNode
from extensions.utils.vanna_text2sql import VannaServer
from models.workflow import WorkflowNodeExecutionStatus

from .entities import VannaNodeData


class Config:
    def __init__(self, supplier):
        self.embedding_supplier = "SiliconFlow"
        self.milvus_uri = dify_config.MILVUS_URI
        self.milvus_database = 'vanna_demo'
        self.supplier = supplier
        self.sql_type = 'postgres'
        self.sql_config = {
            "host": dify_config.DB_HOST,
            "dbname": 'vanna_demo',
            "user": dify_config.DB_USERNAME,
            "password": dify_config.DB_PASSWORD,
            "port": dify_config.DB_PORT
        }

vn_instances = {}

def get_vanna_server(key, combined_config):
    if key not in vn_instances:
        vn_instances[key] = VannaServer(combined_config)
    return vn_instances[key]
class VannaNode(LLMNode):
    # FIXME: figure out why here is different from super class
    _node_data_cls = VannaNodeData  # type: ignore
    _node_type = NodeType.VANNA

    _model_instance: Optional[ModelInstance] = None
    _model_config: Optional[ModelConfigWithCredentialsEntity] = None

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        return {
            "model": {

            }
        }

    def _run(self):
        node_data = cast(VannaNodeData, self.node_data)
        variable = self.graph_runtime_state.variable_pool.get(node_data.query)
        query = variable.text if variable else ""

        model_instance, model_config = self._fetch_model_config(self.node_data.model)
        # 'tongyi' 通义 'openai' openai 'ollama' ollama 'deepseek' deepseek
        llm_type = model_instance.provider.rsplit('/')[-1]
        api_key = ''
        base_url = ''
        if llm_type == 'tongyi':
            api_key = model_instance.credentials.get('dashscope_api_key')
        elif llm_type == 'deepseek':
            api_key = model_instance.credentials.get('api_key')
        elif llm_type == 'ollama':
            base_url = model_instance.credentials.get('base_url')

        cache_kay = llm_type + api_key if api_key else base_url
        model = model_instance.model

        vanna_config = {
            "llm_type": llm_type,
            "model": model,
            "api_key": api_key,
            "ollama_host": base_url
        }
        config = Config("")
        # 合并配置
        combined_config = {**config.__dict__, **config.sql_config, **vanna_config}

        cache_data = get_vanna_server(cache_kay, combined_config)

        # 提问获取sql和结果
        sql = cache_data.generate_sql(query)

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={"output": sql}
        )
    
