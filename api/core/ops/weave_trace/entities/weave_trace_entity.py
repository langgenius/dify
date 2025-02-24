from pydantic import BaseModel, Field
from typing import Any, Union, Optional, List, Dict

class WeaveTokenUsage(BaseModel):
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None

class WeaveMultiModel(BaseModel):
    file_list: Optional[list[str]] = Field(None, description="List of files")



class WeaveTraceModel(WeaveTokenUsage, WeaveMultiModel):
    inputs: Optional[Union[str, Dict[str, Any], List, None]] = Field(None, description="Inputs of the trace")
    attributes: Optional[Union[str, Dict[str, Any], List, None]] = Field(None, description="Metadata and attributes associated with trace")

class WeaveTraceUpdateModel(BaseModel):
    run_id: str = Field(..., description="ID of the run")
    outputs: Optional[Union[str, Dict[str, Any], List, None]] = Field(None, description="Outputs of the trace")