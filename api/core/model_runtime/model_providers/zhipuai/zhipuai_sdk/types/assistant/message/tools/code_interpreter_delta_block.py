from typing import Literal

__all__ = ["CodeInterpreterToolBlock"]

from .....core import BaseModel


class CodeInterpreterToolOutput(BaseModel):
    """代码工具输出结果"""

    type: str  # 代码执行日志，目前只有 logs
    logs: str  # 代码执行的日志结果
    error_msg: str  # 错误信息


class CodeInterpreter(BaseModel):
    """代码解释器"""

    input: str  # 生成的代码片段，输入给代码沙盒
    outputs: list[CodeInterpreterToolOutput]  # 代码执行后的输出结果


class CodeInterpreterToolBlock(BaseModel):
    """代码工具块"""

    code_interpreter: CodeInterpreter  # 代码解释器对象
    type: Literal["code_interpreter"]  # 调用工具的类型，始终为 `code_interpreter`
