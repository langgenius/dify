from typing import Any, Optional, Union

from pydantic import BaseModel, Field, field_validator
from pydantic_core.core_schema import ValidationInfo

from core.ops.utils import replace_text_with_content


class WeaveTokenUsage(BaseModel):
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None


class WeaveMultiModel(BaseModel):
    file_list: Optional[list[str]] = Field(None, description="List of files")


class WeaveTraceModel(WeaveTokenUsage, WeaveMultiModel):
    id: str = Field(..., description="ID of the trace")
    op: str = Field(..., description="Name of the operation")
    inputs: Optional[Union[str, dict[str, Any], list, None]] = Field(None, description="Inputs of the trace")
    outputs: Optional[Union[str, dict[str, Any], list, None]] = Field(None, description="Outputs of the trace")
    attributes: Optional[Union[str, dict[str, Any], list, None]] = Field(
        None, description="Metadata and attributes associated with trace"
    )
    exception: Optional[str] = Field(None, description="Exception message of the trace")

    @field_validator("inputs", "outputs")
    @classmethod
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        values = info.data
        if v == {} or v is None:
            return v
        usage_metadata = {
            "input_tokens": values.get("input_tokens", 0),
            "output_tokens": values.get("output_tokens", 0),
            "total_tokens": values.get("total_tokens", 0),
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
                        "messages": [
                            dict(msg, **{"usage_metadata": usage_metadata, "file_list": file_list}) for msg in v
                        ]
                        if isinstance(v, list)
                        else v,
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
