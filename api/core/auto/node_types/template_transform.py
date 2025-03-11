from .common import BlockEnum, CommonNodeType, Variable

# 引入之前定义的 CommonNodeType 和 Variable
# 假设它们在同一模块中定义


class TemplateTransformNodeType(CommonNodeType):
    """Template transform node type implementation."""

    variables: list[Variable]
    template: str


# 示例用法
if __name__ == "__main__":
    example_node = TemplateTransformNodeType(
        title="Example Template Transform Node",
        desc="A template transform node example",
        type=BlockEnum.template_transform,
        variables=[
            Variable(variable="var1", value_selector=["node1", "key1"]),
            Variable(variable="var2", value_selector=["node2", "key2"]),
        ],
        template="Hello, {{ var1 }}! You have {{ var2 }} new messages.",
    )
    print(example_node)
