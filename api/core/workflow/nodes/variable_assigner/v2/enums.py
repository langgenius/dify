from enum import StrEnum


class Operation(StrEnum):
    OVER_WRITE = "over-write"
    CLEAR = "clear"
    APPEND = "append"
    EXTEND = "extend"
    SET = "set"
    ADD = "+="
    SUBTRACT = "-="
    MULTIPLY = "*="
    DIVIDE = "/="


class InputType(StrEnum):
    VARIABLE = "variable"
    CONSTANT = "constant"
