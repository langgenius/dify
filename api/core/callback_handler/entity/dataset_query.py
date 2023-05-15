from pydantic import BaseModel


class DatasetQueryObj(BaseModel):
    dataset_id: str = None
    query: str = None
