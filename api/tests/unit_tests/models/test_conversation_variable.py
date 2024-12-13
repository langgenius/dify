from uuid import uuid4

from core.variables import SegmentType
from factories import variable_factory
from models import ConversationVariable


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
