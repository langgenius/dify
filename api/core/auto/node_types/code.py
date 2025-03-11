from enum import Enum
from typing import Optional

from pydantic import BaseModel

from core.auto.node_types.common import BlockEnum, CommonNodeType, Variable, VarType

# 引入之前定义的 CommonNodeType、VarType 和 Variable
# 假设它们在同一模块中定义


class CodeLanguage(str, Enum):
    python3 = "python3"
    javascript = "javascript"
    json = "json"


class OutputVar(BaseModel):
    type: VarType
    children: Optional[None] = None  # 未来支持嵌套

    def dict(self, *args, **kwargs):
        """自定义序列化方法，确保正确序列化"""
        result = {"type": self.type.value if isinstance(self.type, Enum) else self.type}

        if self.children is not None:
            result["children"] = self.children

        return result


class CodeNodeType(CommonNodeType):
    variables: list[Variable]
    code_language: CodeLanguage
    code: str
    outputs: dict[str, OutputVar]


# 示例用法
if __name__ == "__main__":
    # 创建示例节点
    example_node = CodeNodeType(
        title="Example Code Node",
        desc="A code node example",
        type=BlockEnum.code,
        code_language=CodeLanguage.python3,
        code="print('Hello, World!')",
        outputs={
            "output1": OutputVar(type=VarType.string),
            "output2": OutputVar(type=VarType.number),
        },
        variables=[
            Variable(variable="var1", value_selector=["node1", "key1"]),
        ],
    )
    print(example_node.get_all_required_fields())
