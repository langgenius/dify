from core.app.app_config.entities import VariableEntity
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeType


class StartNodeData(BaseNodeData):
    """
    - title (string) 节点标题
    - desc (string) optional 节点描述
    - type (string) 节点类型，固定为 start
    - variables (array[object]) 表单变量列表
        - type (string) 表单变量类型，text-input, paragraph, select, number,  files（文件暂不支持自定义）
        - label (string) 控件展示标签名
        - variable (string) 变量 key
        - max_length (int) 最大长度，适用于 text-input 和 paragraph
        - default (string) optional 默认值
        - required (bool) optional是否必填，默认 false
        - hint (string) optional 提示信息
        - options (array[string]) 选项值（仅 select 可用）
    """
    type: str = NodeType.START.value

    variables: list[VariableEntity] = []
