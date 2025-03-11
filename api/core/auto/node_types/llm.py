from typing import Optional, Union

from pydantic import BaseModel

from .common import (
    BlockEnum,
    CommonNodeType,
    Context,
    Memory,
    ModelConfig,
    PromptItem,
    Variable,
    VisionSetting,
)


class PromptConfig(BaseModel):
    """Configuration for prompt template variables."""

    jinja2_variables: Optional[list[Variable]] = None


class VisionConfig(BaseModel):
    """Configuration for vision settings."""

    enabled: bool = False
    configs: Optional[VisionSetting] = None

    def dict(self, *args, **kwargs):
        """自定义序列化方法，确保正确序列化"""
        result = {"enabled": self.enabled}

        if self.configs:
            result["configs"] = self.configs.dict()

        return result


class LLMNodeType(CommonNodeType):
    """LLM node type implementation."""

    model: ModelConfig
    prompt_template: Union[list[PromptItem], PromptItem]
    prompt_config: Optional[PromptConfig] = None
    memory: Optional[Memory] = None
    context: Optional[Context] = Context(enabled=False, variable_selector=None)
    vision: Optional[VisionConfig] = VisionConfig(enabled=False)


# 示例用法
if __name__ == "__main__":
    example_node = LLMNodeType(
        title="Example LLM Node",
        desc="A LLM node example",
        type=BlockEnum.llm,
        model=ModelConfig(provider="zhipuai", name="glm-4-flash", mode="chat", completion_params={"temperature": 0.7}),
        prompt_template=[
            PromptItem(
                id="system-id", role="system", text="你是一个代码工程师，你会根据用户的需求给出用户所需要的函数"
            ),
            PromptItem(id="user-id", role="user", text="给出两数相加的python 函数代码，函数名 func 不要添加其他内容"),
        ],
        context=Context(enabled=False, variable_selector=None),
        vision=VisionConfig(enabled=False),
    )
    print(example_node)
