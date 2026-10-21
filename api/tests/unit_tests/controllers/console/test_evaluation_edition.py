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
