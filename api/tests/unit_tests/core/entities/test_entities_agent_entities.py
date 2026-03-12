from core.entities.agent_entities import PlanningStrategy


def test_planning_strategy_values_are_stable() -> None:
    # Arrange / Act / Assert
    assert PlanningStrategy.ROUTER.value == "router"
    assert PlanningStrategy.REACT_ROUTER.value == "react_router"
    assert PlanningStrategy.REACT.value == "react"
    assert PlanningStrategy.FUNCTION_CALL.value == "function_call"
