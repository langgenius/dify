from .common import BlockEnum, CommonNodeType, InputVar

# Import previously defined CommonNodeType and InputVar
# Assume they are defined in the same module


class StartNodeType(CommonNodeType):
    variables: list[InputVar]


# Example usage
if __name__ == "__main__":
    example_node = StartNodeType(
        title="Example Start Node",
        desc="A start node example",
        type=BlockEnum.start,
        variables=[
            InputVar(type="text-input", label="Input 1", variable="input1", required=True),
            InputVar(type="number", label="Input 2", variable="input2", required=True),
        ],
    )
    print(example_node)
