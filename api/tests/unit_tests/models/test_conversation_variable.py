from uuid import UUID, uuid4

from factories import variable_factory
from graphon.variables import SegmentType
from models import ConversationVariable


def test_from_variable_coerces_non_uuid_id():
    variable = variable_factory.build_conversation_variable_from_mapping(
        {
            "id": "opt-comp-prompt-var",
            "name": "optimization_comparison_prompt",
            "value_type": SegmentType.STRING,
            "value": "-",
        }
    )

    row = ConversationVariable.from_variable(
        app_id="app_id", conversation_id="conversation_id", variable=variable
    )

    UUID(row.id)
    assert row.to_variable().id == variable.id


def test_from_variable_and_to_variable():
    variable = variable_factory.build_conversation_variable_from_mapping(
        {
            "id": str(uuid4()),
            "name": "name",
            "value_type": SegmentType.OBJECT,
            "value": {
                "key": {
                    "key": "value",
                }
            },
        }
    )

    conversation_variable = ConversationVariable.from_variable(
        app_id="app_id", conversation_id="conversation_id", variable=variable
    )

    assert conversation_variable.to_variable() == variable
