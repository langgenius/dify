from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from factories import variable_factory
from graphon.variables import SegmentType
from models import ConversationVariable


def test_from_variable_coerces_non_uuid_primary_key():
    variable = variable_factory.build_conversation_variable_from_mapping(
        {
            "id": "opt-comp-prompt-var",
            "name": "optimization_comparison_prompt",
            "value_type": SegmentType.STRING,
            "value": "-",
        }
    )

    row = ConversationVariable.from_variable(app_id="app_id", conversation_id="conversation_id", variable=variable)

    expected = str(uuid5(NAMESPACE_URL, "dify:conversation-variable:optimization_comparison_prompt"))
    UUID(row.id)
    assert row.id == expected
    assert variable.id == "opt-comp-prompt-var"
    assert row.to_variable().id == "opt-comp-prompt-var"


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
