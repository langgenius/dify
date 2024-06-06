from pydantic import BaseModel


class CodeDependency(BaseModel):
    name: str
    version: str
