import abc
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated, TypeAlias, final

from pydantic import BaseModel, ConfigDict, Discriminator, Tag, field_validator

from core.workflow.nodes.base import BaseNode


@dataclass(frozen=True)
class CommandParams:
    # `next_node_instance` is the instance of the next node to run.
    next_node: BaseNode


class _CommandTag(StrEnum):
    SUSPEND = "suspend"
    STOP = "stop"
    CONTINUE = "continue"


class Command(BaseModel, abc.ABC):
    model_config = ConfigDict(frozen=True)

    tag: _CommandTag

    @field_validator("tag")
    @classmethod
    def validate_value_type(cls, value):
        if value != cls.model_fields["tag"].default:
            raise ValueError("Cannot modify 'tag'")
        return value


@final
class StopCommand(Command):
    tag: _CommandTag = _CommandTag.STOP


@final
class SuspendCommand(Command):
    tag: _CommandTag = _CommandTag.SUSPEND


@final
class ContinueCommand(Command):
    tag: _CommandTag = _CommandTag.CONTINUE


def _get_command_tag(command: Command):
    return command.tag


CommandTypes: TypeAlias = Annotated[
    (
        Annotated[StopCommand, Tag(_CommandTag.STOP)]
        | Annotated[SuspendCommand, Tag(_CommandTag.SUSPEND)]
        | Annotated[ContinueCommand, Tag(_CommandTag.CONTINUE)]
    ),
    Discriminator(_get_command_tag),
]

# `CommandSource` is a callable that takes a single argument of type `CommandParams` and
# returns a `Command` object to the engine, indicating whether the graph engine should suspend, continue, or stop.
#
# It must not modify the data inside `CommandParams`, including any attributes within its fields.
CommandSource: TypeAlias = Callable[[CommandParams], CommandTypes]
