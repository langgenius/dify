from .common import BlockEnum, CommonNodeType

# 引入之前定义的 CommonNodeType
# 假设它们在同一模块中定义


class IterationStartNodeType(CommonNodeType):
    """
    Iteration Start node type implementation.

    This node type is used as the starting point within an iteration block.
    It inherits all properties from CommonNodeType without adding any additional fields.
    """

    pass  # 仅仅继承 CommonNodeType，无其他字段


# 示例用法
if __name__ == "__main__":
    example_node = IterationStartNodeType(
        title="Example Iteration Start Node",
        desc="An iteration start node example",
        type=BlockEnum.iteration_start,
    )
    print(example_node)
