import abc
from typing import Protocol

from core.variables import VariableBase


class ConversationVariableUpdater(Protocol):
    """
    ConversationVariableUpdater defines an abstraction for updating conversation variable values.

    It is intended for use by `v1.VariableAssignerNode` and `v2.VariableAssignerNode` when updating
    conversation variables.

    Implementations may choose to batch updates. If batching is used, the `flush` method
    should be implemented to persist buffered changes, and `update`
    should handle buffering accordingly.

    Note: Since implementations may buffer updates, instances of ConversationVariableUpdater
    are not thread-safe. Each VariableAssignerNode should create its own instance during execution.
    """

    @abc.abstractmethod
    def update(self, conversation_id: str, variable: "VariableBase"):
        """
        Updates the value of the specified conversation variable in the underlying storage.

        :param conversation_id: The ID of the conversation to update. Typically references `ConversationVariable.id`.
        :param variable: The `VariableBase` instance containing the updated value.
        """
        pass

    @abc.abstractmethod
    def flush(self):
        """
        Flushes all pending updates to the underlying storage system.

        If the implementation does not buffer updates, this method can be a no-op.
        """
        pass
