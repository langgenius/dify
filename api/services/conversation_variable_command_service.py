"""Change conversation-variable values without exposing persistence to the use case."""

from collections.abc import Callable
from functools import partial
from typing import Protocol

from pydantic import JsonValue

from factories import variable_factory
from graphon.variables import VariableBase
from graphon.variables.types import SegmentType
from services.conversation_variable_query import ConversationVariableRecord
from services.entities.conversation_entities import EndUserConversationRef
from services.errors.conversation import ConversationVariableTypeMismatchError


class ConversationVariableStore(Protocol):
    def update(
        self,
        *,
        ref: EndUserConversationRef,
        variable_id: str,
        transform: Callable[[VariableBase], VariableBase],
    ) -> ConversationVariableRecord:
        """Apply a pure value transform within the owned write transaction.

        The transform must not perform I/O. Ownership, loading the current value,
        transformation, and saving complete in one transaction.
        """
        ...


class ConversationVariableCommandService:
    def __init__(self, *, variables: ConversationVariableStore) -> None:
        self._variables = variables

    def update_value(
        self, *, ref: EndUserConversationRef, variable_id: str, new_value: JsonValue
    ) -> ConversationVariableRecord:
        return self._variables.update(
            ref=ref,
            variable_id=variable_id,
            transform=partial(self._replace_value, new_value=new_value),
        )

    @staticmethod
    def _replace_value(current_variable: VariableBase, *, new_value: JsonValue) -> VariableBase:
        expected_type = SegmentType(current_variable.value_type)
        # The API exposes stored integers as numbers; preserve the existing check
        # and let the shared factory retain its numeric reconstruction rules.
        if expected_type == SegmentType.INTEGER:
            expected_type = SegmentType.NUMBER
        if not expected_type.is_valid(new_value):
            inferred_type = SegmentType.infer_segment_type(new_value)
            raise ConversationVariableTypeMismatchError(
                f"Type mismatch: variable '{current_variable.name}' expects {expected_type.value}, "
                f"but got {inferred_type.value if inferred_type else 'unknown'} type"
            )
        return variable_factory.build_conversation_variable_from_mapping(
            {
                "id": current_variable.id,
                "name": current_variable.name,
                "description": current_variable.description,
                "value_type": current_variable.value_type,
                "value": new_value,
                "selector": current_variable.selector,
            }
        )
