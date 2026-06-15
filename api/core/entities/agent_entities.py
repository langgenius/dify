from enum import StrEnum, auto


class PlanningStrategy(StrEnum):
    ROUTER = auto()
    REACT_ROUTER = auto()
    REACT = auto()
    FUNCTION_CALL = auto()
