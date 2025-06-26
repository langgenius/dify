import json

from pydantic import BaseModel


class PydanticModelEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, BaseModel):
            return o.model_dump()
        else:
            super().default(o)
