from datetime import datetime
from enum import Enum
from typing import Any, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core.core_schema import ValidationInfo

from core.ops.utils import replace_text_with_content


def validate_input_output(v, field_name):
    """
    Validate input output
    :param v:
    :param field_name:
    :return:
    """
    if v == {} or v is None:
        return v
    if isinstance(v, str):
        return [
            {
                "role": "assistant" if field_name == "output" else "user",
                "content": v,
            }
        ]
    elif isinstance(v, list):
        if len(v) > 0 and isinstance(v[0], dict):
            v = replace_text_with_content(data=v)
            return v
        else:
            return [
                {
                    "role": "assistant" if field_name == "output" else "user",
                    "content": str(v),
                }
            ]

    return v


class LevelEnum(str, Enum):
    DEBUG = "DEBUG"
    WARNING = "WARNING"
    ERROR = "ERROR"
    DEFAULT = "DEFAULT"


class LangfuseTrace(BaseModel):
    """
    Langfuse trace model
    """

    id: Optional[str] = Field(
        default=None,
        description="The id of the trace can be set, defaults to a random id. Used to link traces to external systems "
        "or when creating a distributed trace. Traces are upserted on id.",
    )
    name: Optional[str] = Field(
        default=None,
        description="Identifier of the trace. Useful for sorting/filtering in the UI.",
    )
    input: Optional[Union[str, dict[str, Any], list, None]] = Field(
        default=None, description="The input of the trace. Can be any JSON object."
    )
    output: Optional[Union[str, dict[str, Any], list, None]] = Field(
        default=None, description="The output of the trace. Can be any JSON object."
    )
    metadata: Optional[dict[str, Any]] = Field(
        default=None,
        description="Additional metadata of the trace. Can be any JSON object. Metadata is merged when being updated "
        "via the API.",
    )
    user_id: Optional[str] = Field(
        default=None,
        description="The id of the user that triggered the execution. Used to provide user-level analytics.",
    )
    session_id: Optional[str] = Field(
        default=None,
        description="Used to group multiple traces into a session in Langfuse. Use your own session/thread identifier.",
    )
    version: Optional[str] = Field(
        default=None,
        description="The version of the trace type. Used to understand how changes to the trace type affect metrics. "
        "Useful in debugging.",
    )
    release: Optional[str] = Field(
        default=None,
        description="The release identifier of the current deployment. Used to understand how changes of different "
        "deployments affect metrics. Useful in debugging.",
    )
    tags: Optional[list[str]] = Field(
        default=None,
        description="Tags are used to categorize or label traces. Traces can be filtered by tags in the UI and GET "
        "API. Tags can also be changed in the UI. Tags are merged and never deleted via the API.",
    )
    public: Optional[bool] = Field(
        default=None,
        description="You can make a trace public to share it via a public link. This allows others to view the trace "
        "without needing to log in or be members of your Langfuse project.",
    )

    @field_validator("input", "output")
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        return validate_input_output(v, field_name)


class LangfuseSpan(BaseModel):
    """
    Langfuse span model
    """

    id: Optional[str] = Field(
        default=None,
        description="The id of the span can be set, otherwise a random id is generated. Spans are upserted on id.",
    )
    session_id: Optional[str] = Field(
        default=None,
        description="Used to group multiple spans into a session in Langfuse. Use your own session/thread identifier.",
    )
    trace_id: Optional[str] = Field(
        default=None,
        description="The id of the trace the span belongs to. Used to link spans to traces.",
    )
    user_id: Optional[str] = Field(
        default=None,
        description="The id of the user that triggered the execution. Used to provide user-level analytics.",
    )
    start_time: Optional[datetime | str] = Field(
        default_factory=datetime.now,
        description="The time at which the span started, defaults to the current time.",
    )
    end_time: Optional[datetime | str] = Field(
        default=None,
        description="The time at which the span ended. Automatically set by span.end().",
    )
    name: Optional[str] = Field(
        default=None,
        description="Identifier of the span. Useful for sorting/filtering in the UI.",
    )
    metadata: Optional[dict[str, Any]] = Field(
        default=None,
        description="Additional metadata of the span. Can be any JSON object. Metadata is merged when being updated "
        "via the API.",
    )
    level: Optional[str] = Field(
        default=None,
        description="The level of the span. Can be DEBUG, DEFAULT, WARNING or ERROR. Used for sorting/filtering of "
        "traces with elevated error levels and for highlighting in the UI.",
    )
    status_message: Optional[str] = Field(
        default=None,
        description="The status message of the span. Additional field for context of the event. E.g. the error "
        "message of an error event.",
    )
    input: Optional[Union[str, dict[str, Any], list, None]] = Field(
        default=None, description="The input of the span. Can be any JSON object."
    )
    output: Optional[Union[str, dict[str, Any], list, None]] = Field(
        default=None, description="The output of the span. Can be any JSON object."
    )
    version: Optional[str] = Field(
        default=None,
        description="The version of the span type. Used to understand how changes to the span type affect metrics. "
        "Useful in debugging.",
    )
    parent_observation_id: Optional[str] = Field(
        default=None,
        description="The id of the observation the span belongs to. Used to link spans to observations.",
    )

    @field_validator("input", "output")
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        return validate_input_output(v, field_name)


class UnitEnum(str, Enum):
    CHARACTERS = "CHARACTERS"
    TOKENS = "TOKENS"
    SECONDS = "SECONDS"
    MILLISECONDS = "MILLISECONDS"
    IMAGES = "IMAGES"


class GenerationUsage(BaseModel):
    promptTokens: Optional[int] = None
    completionTokens: Optional[int] = None
    total: Optional[int] = None
    input: Optional[int] = None
    output: Optional[int] = None
    unit: Optional[UnitEnum] = None
    inputCost: Optional[float] = None
    outputCost: Optional[float] = None
    totalCost: Optional[float] = None

    @field_validator("input", "output")
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        return validate_input_output(v, field_name)


class LangfuseGeneration(BaseModel):
    id: Optional[str] = Field(
        default=None,
        description="The id of the generation can be set, defaults to random id.",
    )
    trace_id: Optional[str] = Field(
        default=None,
        description="The id of the trace the generation belongs to. Used to link generations to traces.",
    )
    parent_observation_id: Optional[str] = Field(
        default=None,
        description="The id of the observation the generation belongs to. Used to link generations to observations.",
    )
    name: Optional[str] = Field(
        default=None,
        description="Identifier of the generation. Useful for sorting/filtering in the UI.",
    )
    start_time: Optional[datetime | str] = Field(
        default_factory=datetime.now,
        description="The time at which the generation started, defaults to the current time.",
    )
    completion_start_time: Optional[datetime | str] = Field(
        default=None,
        description="The time at which the completion started (streaming). Set it to get latency analytics broken "
        "down into time until completion started and completion duration.",
    )
    end_time: Optional[datetime | str] = Field(
        default=None,
        description="The time at which the generation ended. Automatically set by generation.end().",
    )
    model: Optional[str] = Field(default=None, description="The name of the model used for the generation.")
    model_parameters: Optional[dict[str, Any]] = Field(
        default=None,
        description="The parameters of the model used for the generation; can be any key-value pairs.",
    )
    input: Optional[Any] = Field(
        default=None,
        description="The prompt used for the generation. Can be any string or JSON object.",
    )
    output: Optional[Any] = Field(
        default=None,
        description="The completion generated by the model. Can be any string or JSON object.",
    )
    usage: Optional[GenerationUsage] = Field(
        default=None,
        description="The usage object supports the OpenAi structure with tokens and a more generic version with "
        "detailed costs and units.",
    )
    metadata: Optional[dict[str, Any]] = Field(
        default=None,
        description="Additional metadata of the generation. Can be any JSON object. Metadata is merged when being "
        "updated via the API.",
    )
    level: Optional[LevelEnum] = Field(
        default=None,
        description="The level of the generation. Can be DEBUG, DEFAULT, WARNING or ERROR. Used for sorting/filtering "
        "of traces with elevated error levels and for highlighting in the UI.",
    )
    status_message: Optional[str] = Field(
        default=None,
        description="The status message of the generation. Additional field for context of the event. E.g. the error "
        "message of an error event.",
    )
    version: Optional[str] = Field(
        default=None,
        description="The version of the generation type. Used to understand how changes to the span type affect "
        "metrics. Useful in debugging.",
    )

    model_config = ConfigDict(protected_namespaces=())

    @field_validator("input", "output")
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        return validate_input_output(v, field_name)
