from enum import Enum
from typing import Optional, Union

from pydantic import BaseModel

from .common import BlockEnum, CommonNodeType, ValueSelector, VarType
from .tool import VarType as NumberVarType

# Import previously defined CommonNodeType, ValueSelector, Var, and VarType
# Assume they are defined in the same module


class LogicalOperator(str, Enum):
    and_ = "and"
    or_ = "or"


class ComparisonOperator(str, Enum):
    contains = "contains"
    notContains = "not contains"
    startWith = "start with"
    endWith = "end with"
    is_ = "is"
    isNot = "is not"
    empty = "empty"
    notEmpty = "not empty"
    equal = "="
    notEqual = "≠"
    largerThan = ">"
    lessThan = "<"
    largerThanOrEqual = "≥"
    lessThanOrEqual = "≤"
    isNull = "is null"
    isNotNull = "is not null"
    in_ = "in"
    notIn = "not in"
    allOf = "all of"
    exists = "exists"
    notExists = "not exists"
    equals = "="  # Alias for equal for compatibility


class Condition(BaseModel):
    id: str
    varType: VarType
    variable_selector: Optional[ValueSelector]
    key: Optional[str] = None  # Sub variable key
    comparison_operator: Optional[ComparisonOperator] = None
    value: Union[str, list[str]]
    numberVarType: Optional[NumberVarType]
    sub_variable_condition: Optional["CaseItem"] = None  # Recursive reference


class CaseItem(BaseModel):
    case_id: str
    logical_operator: LogicalOperator
    conditions: list[Condition]


class IfElseNodeType(CommonNodeType):
    logical_operator: Optional[LogicalOperator] = None
    conditions: Optional[list[Condition]] = None
    cases: list[CaseItem]
    isInIteration: bool


# Example usage
if __name__ == "__main__":
    example_node = IfElseNodeType(
        title="Example IfElse Node",
        desc="An if-else node example",
        type=BlockEnum.if_else,
        logical_operator=LogicalOperator.and_,
        conditions=[
            Condition(
                id="condition1",
                varType=VarType.string,
                variable_selector={"nodeId": "varNode", "key": "value"},
                comparison_operator=ComparisonOperator.is_,
                value="exampleValue",
            )
        ],
        cases=[
            CaseItem(
                case_id="case1",
                logical_operator=LogicalOperator.or_,
                conditions=[
                    Condition(
                        id="condition2",
                        varType=VarType.number,
                        value="10",
                        comparison_operator=ComparisonOperator.largerThan,
                    )
                ],
            )
        ],
        isInIteration=True,
    )
    print(example_node)
