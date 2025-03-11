from .common import BlockEnum, CommonNodeType, Variable


class AnswerNodeType(CommonNodeType):
    variables: list[Variable]
    answer: str


# Example usage
if __name__ == "__main__":
    example_node = AnswerNodeType(
        title="Example Answer Node",
        desc="An answer node example",
        type=BlockEnum.answer,
        answer="This is the answer",
        variables=[
            Variable(variable="var1", value_selector=["node1", "key1"]),
            Variable(variable="var2", value_selector=["node2", "key2"]),
        ],
    )
    print(example_node)
