from pydantic import BaseModel

from .common import BlockEnum, CommonNodeType, ValueSelector, VarType


class VarGroupItem(BaseModel):
    """Variable group item configuration."""

    output_type: VarType
    variables: list[ValueSelector]


class GroupConfig(VarGroupItem):
    """Group configuration for advanced settings."""

    group_name: str
    groupId: str


class AdvancedSettings(BaseModel):
    """Advanced settings for variable assigner."""

    group_enabled: bool
    groups: list[GroupConfig]


class VariableAssignerNodeType(CommonNodeType, VarGroupItem):
    """Variable assigner node type implementation."""

    advanced_settings: AdvancedSettings

    class Config:
        arbitrary_types_allowed = True


# Example usage
if __name__ == "__main__":
    example_node = VariableAssignerNodeType(
        title="Example Variable Assigner Node",
        desc="A variable assigner node example",
        type=BlockEnum.variable_assigner,
        output_type=VarType.string,
        variables=[ValueSelector(value=["varNode1", "value1"]), ValueSelector(value=["varNode2", "value2"])],
        advanced_settings=AdvancedSettings(
            group_enabled=True,
            groups=[
                GroupConfig(
                    group_name="Group 1",
                    groupId="group1",
                    output_type=VarType.number,
                    variables=[ValueSelector(value=["varNode3", "value3"])],
                )
            ],
        ),
    )
    print(example_node.json(indent=2))  # Print as JSON format for viewing
