from types import FunctionType

from flask_restx import Resource

from controllers.console import evaluation as evaluation_controller


def test_all_evaluation_resources_require_a_supported_edition() -> None:
    resource_classes = [
        value
        for value in vars(evaluation_controller).values()
        if isinstance(value, type)
        and value.__module__ == evaluation_controller.__name__
        and issubclass(value, Resource)
        and value is not evaluation_controller.EvaluationEditionResource
    ]

    assert resource_classes
    assert all(
        issubclass(resource_class, evaluation_controller.EvaluationEditionResource)
        for resource_class in resource_classes
    )


def test_all_evaluation_methods_check_plan_after_account_initialization() -> None:
    resource_classes = [
        value
        for value in vars(evaluation_controller).values()
        if isinstance(value, type)
        and value.__module__ == evaluation_controller.__name__
        and issubclass(value, evaluation_controller.EvaluationEditionResource)
        and value is not evaluation_controller.EvaluationEditionResource
    ]
    methods = [
        value
        for resource_class in resource_classes
        for name, value in vars(resource_class).items()
        if name in {"get", "post", "put", "patch", "delete"}
    ]

    assert methods
    for method in methods:
        wrapper_names: list[str] = []
        wrapper = method
        while isinstance(wrapper, FunctionType):
            wrapper_names.append(wrapper.__code__.co_qualname)
            wrapper = getattr(wrapper, "__wrapped__", None)

        account_index = next(
            index
            for index, name in enumerate(wrapper_names)
            if "account_initialization_required.<locals>.decorated" in name
        )
        plan_index = next(
            index
            for index, name in enumerate(wrapper_names)
            if "evaluation_paid_plan_required.<locals>.evaluation_plan_decorated" in name
        )
        assert account_index < plan_index
