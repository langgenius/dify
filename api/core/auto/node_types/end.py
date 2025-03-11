from .common import BlockEnum, CommonNodeType, Variable

# Import previously defined CommonNodeType and Variable
# Assume they are defined in the same module


class EndNodeType(CommonNodeType):
    outputs: list[Variable]


# Example usage
if __name__ == "__main__":
    example_node = EndNodeType(
        title="Example End Node",
        desc="An end node example",
        type=BlockEnum.end,
        outputs=[
            Variable(variable="outputVar1", value_selector=["node1", "key1"]),
            Variable(variable="outputVar2", value_selector=["node2", "key2"]),
        ],
    )
    print(example_node)
