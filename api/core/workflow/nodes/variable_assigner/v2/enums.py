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
    REMOVE_FIRST = "remove-first"
    REMOVE_LAST = "remove-last"


class InputType(StrEnum):
    VARIABLE = "variable"
    CONSTANT = "constant"
