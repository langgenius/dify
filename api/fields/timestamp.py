from typing import Annotated

from pydantic import Field

Timestamp = Annotated[int, Field(..., description="Unix timestamp in milliseconds")]
