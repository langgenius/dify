from enum import StrEnum


class Operation(StrEnum):
    OVER_WRITE = "over-write"
    CLEAR = "clear"
    APPEND = "append"
    EXTEND = "extend"
    SET = "set"
    ADD = "add"
    SUBTRACT = "subtract"
    MULTIPLY = "multiply"
    DIVIDE = "divide"


class InputType(StrEnum):
    VARIABLE = "variable"
    CONSTANT = "constant"
