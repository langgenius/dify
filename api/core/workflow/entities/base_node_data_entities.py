from pydantic import BaseModel


class BaseIterationState(BaseModel):
    iteration_node_id: str
    index: int
    inputs: dict

    class MetaData(BaseModel):
        pass

    metadata: MetaData
