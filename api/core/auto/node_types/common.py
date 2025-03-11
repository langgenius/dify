from enum import Enum
from typing import Any, Optional, Union

import yaml
from pydantic import BaseModel, Field


# BlockEnum 枚举
class BlockEnum(str, Enum):
    start = "start"
    end = "end"
    answer = "answer"
    llm = "llm"
    knowledge_retrieval = "knowledge-retrieval"
    question_classifier = "question-classifier"
    if_else = "if-else"
    code = "code"
    template_transform = "template-transform"
    http_request = "http-request"
    variable_assigner = "variable-assigner"
    variable_aggregator = "variable-aggregator"
    tool = "tool"
    parameter_extractor = "parameter-extractor"
    iteration = "iteration"
    document_extractor = "document-extractor"
    list_operator = "list-operator"
    iteration_start = "iteration-start"
    assigner = "assigner"  # is now named as VariableAssigner
    agent = "agent"


# Error枚举
class ErrorHandleMode(str, Enum):
    terminated = "terminated"
    continue_on_error = "continue-on-error"
    remove_abnormal_output = "remove-abnormal-output"


class ErrorHandleTypeEnum(str, Enum):
    none = ("none",)
    failBranch = ("fail-branch",)
    defaultValue = ("default-value",)


# Branch 类型
class Branch(BaseModel):
    id: str
    name: str


# NodeRunningStatus 枚举
class NodeRunningStatus(str, Enum):
    not_start = "not-start"
    waiting = "waiting"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    exception = "exception"
    retry = "retry"


# 创建一个基类来统一CommonNodeType和CommonEdgeType的序列化逻辑
class BaseType(BaseModel):
    """基类，用于统一CommonNodeType和CommonEdgeType的序列化逻辑"""

    def to_json(self) -> dict[str, Any]:
        """
        将对象转换为JSON格式的字典,通过循环模型字段来构建JSON数据
        """
        json_data = {}

        # 获取模型的所有字段
        for field_name, field_value in self.__dict__.items():
            if field_value is not None:
                # 特殊处理Branch类型的列表
                if field_name == "_targetBranches" and field_value is not None:
                    json_data[field_name] = [branch.dict(exclude_none=True) for branch in field_value]
                # 处理枚举类型
                elif isinstance(field_value, Enum):
                    json_data[field_name] = field_value.value
                # 处理嵌套的Pydantic模型
                elif hasattr(field_value, "dict") and callable(field_value.dict):
                    json_data[field_name] = field_value.dict(exclude_none=True)
                # 处理列表中的Pydantic模型
                elif isinstance(field_value, list):
                    processed_list = []
                    for item in field_value:
                        if hasattr(item, "dict") and callable(item.dict):
                            processed_list.append(item.dict(exclude_none=True))
                        else:
                            processed_list.append(item)
                    json_data[field_name] = processed_list
                # 处理字典中的Pydantic模型
                elif isinstance(field_value, dict):
                    processed_dict = {}
                    for key, value in field_value.items():
                        if hasattr(value, "dict") and callable(value.dict):
                            processed_dict[key] = value.dict(exclude_none=True)
                        else:
                            processed_dict[key] = value
                    json_data[field_name] = processed_dict
                # 其他字段直接添加
                else:
                    json_data[field_name] = field_value

        return json_data


# CommonNodeType 类型
class CommonNodeType(BaseType):
    _connectedSourceHandleIds: Optional[list[str]] = None
    _connectedTargetHandleIds: Optional[list[str]] = None
    _targetBranches: Optional[list[Branch]] = None
    _isSingleRun: Optional[bool] = None
    _runningStatus: Optional[NodeRunningStatus] = None
    _singleRunningStatus: Optional[NodeRunningStatus] = None
    _isCandidate: Optional[bool] = None
    _isBundled: Optional[bool] = None
    _children: Optional[list[str]] = None
    _isEntering: Optional[bool] = None
    _showAddVariablePopup: Optional[bool] = None
    _holdAddVariablePopup: Optional[bool] = None
    _iterationLength: Optional[int] = None
    _iterationIndex: Optional[int] = None
    _inParallelHovering: Optional[bool] = None
    isInIteration: Optional[bool] = None
    iteration_id: Optional[str] = None
    selected: Optional[bool] = None
    title: str
    desc: str
    type: BlockEnum
    width: Optional[float] = None
    height: Optional[float] = None

    @classmethod
    def get_all_required_fields(cls) -> dict[str, str]:
        """
        获取所有必选字段，包括从父类继承的字段
        这是一个类方法，可以通过类直接调用
        """
        all_required_fields = {}

        # 获取所有父类（除了 object 和 BaseModel）
        mro = [c for c in cls.__mro__ if c not in (object, BaseModel, BaseType)]

        # 从父类到子类的顺序处理，这样子类的字段会覆盖父类的同名字段
        for class_type in reversed(mro):
            if hasattr(class_type, "__annotations__"):
                for field_name, field_info in class_type.__annotations__.items():
                    # 检查字段是否有默认值
                    has_default = hasattr(class_type, field_name)
                    # 检查字段是否为可选类型
                    is_optional = "Optional" in str(field_info)

                    # 如果字段没有默认值且不是Optional类型，则为必选字段
                    if not has_default and not is_optional:
                        all_required_fields[field_name] = str(field_info)

        return all_required_fields


# CommonEdgeType 类型
class CommonEdgeType(BaseType):
    _hovering: Optional[bool] = None
    _connectedNodeIsHovering: Optional[bool] = None
    _connectedNodeIsSelected: Optional[bool] = None
    _run: Optional[bool] = None
    _isBundled: Optional[bool] = None
    isInIteration: Optional[bool] = None
    iteration_id: Optional[str] = None
    sourceType: BlockEnum
    targetType: BlockEnum


class ValueSelector(BaseModel):
    """Value selector for selecting values from other nodes."""

    value: list[str] = Field(default_factory=list)

    def dict(self, *args, **kwargs):
        """自定义序列化方法，直接返回 value 列表"""
        return self.value


# Add Context class for LLM node
class Context(BaseModel):
    """Context configuration for LLM node."""

    enabled: bool = False
    variable_selector: Optional[ValueSelector] = None

    def dict(self, *args, **kwargs):
        """自定义序列化方法，确保 variable_selector 字段正确序列化"""
        result = {"enabled": self.enabled}

        if self.variable_selector:
            result["variable_selector"] = self.variable_selector.dict()
        else:
            result["variable_selector"] = []

        return result


# Variable 类型
class Variable(BaseModel):
    """
    变量类型，用于定义节点的输入/输出变量
    与Dify中的Variable类型保持一致
    """

    variable: str  # 变量名
    label: Optional[Union[str, dict[str, str]]] = None  # 变量标签，可以是字符串或对象
    value_selector: list[str]  # 变量值选择器，格式为[nodeId, key]
    variable_type: Optional[str] = None  # 变量类型，对应Dify中的VarType枚举
    value: Optional[str] = None  # 变量值（常量值）
    options: Optional[list[str]] = None  # 选项列表（用于select类型）
    required: Optional[bool] = None  # 是否必填
    isParagraph: Optional[bool] = None  # 是否为段落
    max_length: Optional[int] = None  # 最大长度

    def dict(self, *args, **kwargs):
        """自定义序列化方法，确保正确序列化"""
        result = {"variable": self.variable}

        if self.label is not None:
            result["label"] = self.label

        if self.value_selector:
            result["value_selector"] = self.value_selector

        if self.variable_type is not None:
            result["type"] = self.variable_type  # 使用type而不是variable_type，与Dify保持一致

        if self.value is not None:
            result["value"] = self.value

        if self.options is not None:
            result["options"] = self.options

        if self.required is not None:
            result["required"] = self.required

        if self.isParagraph is not None:
            result["isParagraph"] = self.isParagraph

        if self.max_length is not None:
            result["max_length"] = self.max_length

        return result


# EnvironmentVariable 类型
class EnvironmentVariable(BaseModel):
    id: str
    name: str
    value: Any
    value_type: str  # Expecting to be either 'string', 'number', or 'secret'


# ConversationVariable 类型
class ConversationVariable(BaseModel):
    id: str
    name: str
    value_type: str
    value: Any
    description: str


# GlobalVariable 类型
class GlobalVariable(BaseModel):
    name: str
    value_type: str  # Expecting to be either 'string' or 'number'
    description: str


# VariableWithValue 类型
class VariableWithValue(BaseModel):
    key: str
    value: str


# InputVarType 枚举
class InputVarType(str, Enum):
    text_input = "text-input"
    paragraph = "paragraph"
    select = "select"
    number = "number"
    url = "url"
    files = "files"
    json = "json"
    contexts = "contexts"
    iterator = "iterator"
    file = "file"
    file_list = "file-list"


# InputVar 类型
class InputVar(BaseModel):
    type: InputVarType
    label: Union[str, dict[str, Any]]  # 可以是字符串或对象
    variable: str
    max_length: Optional[int] = None
    default: Optional[str] = None
    required: bool
    hint: Optional[str] = None
    options: Optional[list[str]] = None
    value_selector: Optional[list[str]] = None

    def dict(self, *args, **kwargs):
        """自定义序列化方法，确保正确序列化"""
        result = {
            "type": self.type.value if isinstance(self.type, Enum) else self.type,
            "label": self.label,
            "variable": self.variable,
            "required": self.required,
        }

        if self.max_length is not None:
            result["max_length"] = self.max_length

        if self.default is not None:
            result["default"] = self.default

        if self.hint is not None:
            result["hint"] = self.hint

        if self.options is not None:
            result["options"] = self.options

        if self.value_selector is not None:
            result["value_selector"] = self.value_selector

        return result


# ModelConfig 类型
class ModelConfig(BaseModel):
    provider: str
    name: str
    mode: str
    completion_params: dict[str, Any]


# PromptRole 枚举
class PromptRole(str, Enum):
    system = "system"
    user = "user"
    assistant = "assistant"


# EditionType 枚举
class EditionType(str, Enum):
    basic = "basic"
    jinja2 = "jinja2"


# PromptItem 类型
class PromptItem(BaseModel):
    id: Optional[str] = None
    role: Optional[PromptRole] = None
    text: str
    edition_type: Optional[EditionType] = None
    jinja2_text: Optional[str] = None

    def dict(self, *args, **kwargs):
        """自定义序列化方法，确保 role 字段正确序列化"""
        result = {"id": self.id, "text": self.text}

        if self.role:
            result["role"] = self.role.value

        if self.edition_type:
            result["edition_type"] = self.edition_type.value

        if self.jinja2_text:
            result["jinja2_text"] = self.jinja2_text

        return result


# MemoryRole 枚举
class MemoryRole(str, Enum):
    user = "user"
    assistant = "assistant"


# RolePrefix 类型
class RolePrefix(BaseModel):
    user: str
    assistant: str


# Memory 类型
class Memory(BaseModel):
    role_prefix: Optional[RolePrefix] = None
    window: dict[str, Any]  # Expecting to have 'enabled' and 'size'
    query_prompt_template: str


# VarType 枚举
class VarType(str, Enum):
    string = "string"
    number = "number"
    secret = "secret"
    boolean = "boolean"
    object = "object"
    file = "file"
    array = "array"
    arrayString = "array[string]"
    arrayNumber = "array[number]"
    arrayObject = "array[object]"
    arrayFile = "array[file]"
    any = "any"


# Var 类型
class Var(BaseModel):
    variable: str
    type: VarType
    children: Optional[list["Var"]] = None  # Self-reference
    isParagraph: Optional[bool] = None
    isSelect: Optional[bool] = None
    options: Optional[list[str]] = None
    required: Optional[bool] = None
    des: Optional[str] = None
    isException: Optional[bool] = None

    def dict(self, *args, **kwargs):
        """自定义序列化方法，确保type字段正确序列化"""
        result = {"variable": self.variable, "type": self.type.value if isinstance(self.type, Enum) else self.type}

        if self.children is not None:
            result["children"] = [child.dict() for child in self.children]

        if self.isParagraph is not None:
            result["isParagraph"] = self.isParagraph

        if self.isSelect is not None:
            result["isSelect"] = self.isSelect

        if self.options is not None:
            result["options"] = self.options

        if self.required is not None:
            result["required"] = self.required

        if self.des is not None:
            result["des"] = self.des

        if self.isException is not None:
            result["isException"] = self.isException

        return result


# NodeOutPutVar 类型
class NodeOutPutVar(BaseModel):
    nodeId: str
    title: str
    vars: list[Var]
    isStartNode: Optional[bool] = None


# Block 类型
class Block(BaseModel):
    classification: Optional[str] = None
    type: BlockEnum
    title: str
    description: Optional[str] = None


# NodeDefault 类型
class NodeDefault(BaseModel):
    defaultValue: dict[str, Any]
    getAvailablePrevNodes: Any  # Placeholder for function reference
    getAvailableNextNodes: Any  # Placeholder for function reference
    checkValid: Any  # Placeholder for function reference


# OnSelectBlock 类型
class OnSelectBlock(BaseModel):
    nodeType: BlockEnum
    additional_data: Optional[dict[str, Any]] = None


# WorkflowRunningStatus 枚举
class WorkflowRunningStatus(str, Enum):
    waiting = "waiting"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    stopped = "stopped"


# WorkflowVersion 枚举
class WorkflowVersion(str, Enum):
    draft = "draft"
    latest = "latest"


# OnNodeAdd 类型
class OnNodeAdd(BaseModel):
    nodeType: BlockEnum
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None
    toolDefaultValue: Optional[dict[str, Any]] = None


# CheckValidRes 类型
class CheckValidRes(BaseModel):
    isValid: bool
    errorMessage: Optional[str] = None


# RunFile 类型
class RunFile(BaseModel):
    type: str
    transfer_method: list[str]
    url: Optional[str] = None
    upload_file_id: Optional[str] = None


# WorkflowRunningData 类型
class WorkflowRunningData(BaseModel):
    task_id: Optional[str] = None
    message_id: Optional[str] = None
    conversation_id: Optional[str] = None
    result: dict[str, Any]  # Expecting a structured object
    tracing: Optional[list[dict[str, Any]]] = None  # Placeholder for NodeTracing


# HistoryWorkflowData 类型
class HistoryWorkflowData(BaseModel):
    id: str
    sequence_number: int
    status: str
    conversation_id: Optional[str] = None


# ChangeType 枚举
class ChangeType(str, Enum):
    changeVarName = "changeVarName"
    remove = "remove"


# MoreInfo 类型
class MoreInfo(BaseModel):
    type: ChangeType
    payload: Optional[dict[str, Any]] = None


# ToolWithProvider 类型
class ToolWithProvider(BaseModel):
    tools: list[dict[str, Any]]  # Placeholder for Tool type


# SupportUploadFileTypes 枚举
class SupportUploadFileTypes(str, Enum):
    image = "image"
    document = "document"
    audio = "audio"
    video = "video"
    custom = "custom"


# UploadFileSetting 类型
class UploadFileSetting(BaseModel):
    allowed_file_upload_methods: list[str]
    allowed_file_types: list[SupportUploadFileTypes]
    allowed_file_extensions: Optional[list[str]] = None
    max_length: int
    number_limits: Optional[int] = None


# VisionSetting 类型
class VisionSetting(BaseModel):
    variable_selector: list[str]
    detail: dict[str, Any]  # Placeholder for Resolution type


# 创建一个基类来统一序列化逻辑
class CompleteBase(BaseModel):
    """基类，用于统一CompleteNode和CompleteEdge的序列化逻辑"""

    def to_json(self):
        """将对象转换为JSON格式的字典"""
        json_data = {}

        # 获取模型的所有字段
        for field_name, field_value in self.__dict__.items():
            if field_value is not None:
                # 处理嵌套的数据对象
                if field_name == "data" and hasattr(field_value, "to_json"):
                    json_data[field_name] = field_value.to_json()
                # 处理枚举类型
                elif isinstance(field_value, Enum):
                    json_data[field_name] = field_value.value
                # 处理嵌套的Pydantic模型
                elif hasattr(field_value, "dict") and callable(field_value.dict):
                    json_data[field_name] = field_value.dict(exclude_none=True)
                # 处理列表中的Pydantic模型
                elif isinstance(field_value, list):
                    processed_list = []
                    for item in field_value:
                        if hasattr(item, "dict") and callable(item.dict):
                            processed_list.append(item.dict(exclude_none=True))
                        else:
                            processed_list.append(item)
                    json_data[field_name] = processed_list
                # 处理字典中的Pydantic模型
                elif isinstance(field_value, dict):
                    processed_dict = {}
                    for key, value in field_value.items():
                        if hasattr(value, "dict") and callable(value.dict):
                            processed_dict[key] = value.dict(exclude_none=True)
                        else:
                            processed_dict[key] = value
                    json_data[field_name] = processed_dict
                # 其他字段直接添加
                else:
                    json_data[field_name] = field_value

        return json_data

    def to_yaml(self):
        """将对象转换为YAML格式的字符串"""
        return yaml.dump(self.to_json(), allow_unicode=True)


class CompleteNode(CompleteBase):
    id: str
    position: dict
    height: int
    width: float
    positionAbsolute: dict
    selected: bool
    sourcePosition: Union[dict, str]
    targetPosition: Union[dict, str]
    type: str
    data: Optional[Union[CommonNodeType, None]] = None  # Flexible field to store CommonNodeType or None

    def add_data(self, data: Union[CommonNodeType, None]):
        self.data = data

    def to_json(self):
        json_data = super().to_json()

        # 特殊处理sourcePosition和targetPosition
        json_data["sourcePosition"] = "right"  # 直接输出为字符串"right"
        json_data["targetPosition"] = "left"  # 直接输出为字符串"left"

        # 确保 width 是整数而不是浮点数
        if isinstance(json_data["width"], float):
            json_data["width"] = int(json_data["width"])

        return json_data


class CompleteEdge(CompleteBase):
    id: str
    source: str
    sourceHandle: str
    target: str
    targetHandle: str
    type: str
    zIndex: int
    data: Optional[Union[CommonEdgeType, None]] = None  # Flexible field to store CommonEdgeType or None

    def add_data(self, data: Union[CommonEdgeType, None]):
        self.data = data


# 示例用法
if __name__ == "__main__":
    # 这里可以添加示例数据进行验证
    common_node = CompleteNode(
        id="1740019130520",
        position={"x": 80, "y": 282},
        height=100,
        width=100,
        positionAbsolute={"x": 80, "y": 282},
        selected=True,
        sourcePosition={"x": 80, "y": 282},
        targetPosition={"x": 80, "y": 282},
        type="custom",
    )
    common_data = CommonNodeType(title="示例节点", desc="这是一个示例节点", type="")
    print(CommonNodeType.get_all_required_fields())
    common_node.add_data(common_data)
    # print(common_node)
