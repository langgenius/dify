from enum import Enum


class PlanningStrategy(Enum):
    ROUTER = 'router'
    REACT_ROUTER = 'react_router'
    REACT = 'react'
    FUNCTION_CALL = 'function_call'
