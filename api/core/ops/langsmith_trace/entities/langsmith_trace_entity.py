from datetime import datetime
from enum import Enum
from typing import Any, Optional, Union

from pydantic import BaseModel, Field, field_validator
from pydantic_core.core_schema import ValidationInfo

from core.ops.utils import replace_text_with_content


class LangSmithRunType(str, Enum):
    tool = "tool"
    chain = "chain"
    llm = "llm"
    retriever = "retriever"
    embedding = "embedding"
    prompt = "prompt"
    parser = "parser"


class LangSmithTokenUsage(BaseModel):
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None


class LangSmithMultiModel(BaseModel):
    file_list: Optional[list[str]] = Field(None, description="List of files")


class LangSmithRunModel(LangSmithTokenUsage, LangSmithMultiModel):
    name: Optional[str] = Field(..., description="Name of the run")
    inputs: Optional[Union[str, dict[str, Any], list, None]] = Field(None, description="Inputs of the run")
    outputs: Optional[Union[str, dict[str, Any], list, None]] = Field(None, description="Outputs of the run")
    run_type: LangSmithRunType = Field(..., description="Type of the run")
    start_time: Optional[datetime | str] = Field(None, description="Start time of the run")
    end_time: Optional[datetime | str] = Field(None, description="End time of the run")
    extra: Optional[dict[str, Any]] = Field(
        None, description="Extra information of the run"
    )
    error: Optional[str] = Field(None, description="Error message of the run")
    serialized: Optional[dict[str, Any]] = Field(
        None, description="Serialized data of the run"
    )
    parent_run_id: Optional[str] = Field(None, description="Parent run ID")
    events: Optional[list[dict[str, Any]]] = Field(
        None, description="Events associated with the run"
    )
    tags: Optional[list[str]] = Field(None, description="Tags associated with the run")
    trace_id: Optional[str] = Field(
        None, description="Trace ID associated with the run"
    )
    dotted_order: Optional[str] = Field(None, description="Dotted order of the run")
    id: Optional[str] = Field(None, description="ID of the run")
    session_id: Optional[str] = Field(
        None, description="Session ID associated with the run"
    )
    session_name: Optional[str] = Field(
        None, description="Session name associated with the run"
    )
    reference_example_id: Optional[str] = Field(
        None, description="Reference example ID associated with the run"
    )
    input_attachments: Optional[dict[str, Any]] = Field(
        None, description="Input attachments of the run"
    )
    output_attachments: Optional[dict[str, Any]] = Field(
        None, description="Output attachments of the run"
    )

    @field_validator("inputs", "outputs")
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        values = info.data
        if v == {} or v is None:
            return v
        usage_metadata = {
            "input_tokens": values.get('input_tokens', 0),
            "output_tokens": values.get('output_tokens', 0),
            "total_tokens": values.get('total_tokens', 0),
        }
        file_list = values.get("file_list", [])
        if isinstance(v, str):
            if field_name == "inputs":
                return {
                    "messages": {
                        "role": "user",
                        "content": v,
                        "usage_metadata": usage_metadata,
                        "file_list": file_list,
                    },
                }
            elif field_name == "outputs":
                return {
                    "choices": {
                        "role": "ai",
                        "content": v,
                        "usage_metadata": usage_metadata,
                        "file_list": file_list,
                    },
                }
        elif isinstance(v, list):
            data = {}
            if len(v) > 0 and isinstance(v[0], dict):
                # rename text to content
                v = replace_text_with_content(data=v)
                if field_name == "inputs":
                    data = {
                        "messages": v,
                    }
                elif field_name == "outputs":
                    data = {
                        "choices": {
                            "role": "ai",
                            "content": v,
                            "usage_metadata": usage_metadata,
                            "file_list": file_list,
                        },
                    }
                return data
            else:
                return {
                    "choices": {
                        "role": "ai" if field_name == "outputs" else "user",
                        "content": str(v),
                        "usage_metadata": usage_metadata,
                        "file_list": file_list,
                    },
                }
        if isinstance(v, dict):
            v["usage_metadata"] = usage_metadata
            v["file_list"] = file_list
            return v
        return v

    @field_validator("start_time", "end_time")
    def format_time(cls, v, info: ValidationInfo):
        if not isinstance(v, datetime):
            raise ValueError(f"{info.field_name} must be a datetime object")
        else:
            return v.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class LangSmithRunUpdateModel(BaseModel):
    run_id: str = Field(..., description="ID of the run")
    trace_id: Optional[str] = Field(
        None, description="Trace ID associated with the run"
    )
    dotted_order: Optional[str] = Field(None, description="Dotted order of the run")
    parent_run_id: Optional[str] = Field(None, description="Parent run ID")
    end_time: Optional[datetime | str] = Field(None, description="End time of the run")
    error: Optional[str] = Field(None, description="Error message of the run")
    inputs: Optional[dict[str, Any]] = Field(None, description="Inputs of the run")
    outputs: Optional[dict[str, Any]] = Field(None, description="Outputs of the run")
    events: Optional[list[dict[str, Any]]] = Field(
        None, description="Events associated with the run"
    )
    tags: Optional[list[str]] = Field(None, description="Tags associated with the run")
    extra: Optional[dict[str, Any]] = Field(
        None, description="Extra information of the run"
    )
    input_attachments: Optional[dict[str, Any]] = Field(
        None, description="Input attachments of the run"
    )
    output_attachments: Optional[dict[str, Any]] = Field(
        None, description="Output attachments of the run"
    )
