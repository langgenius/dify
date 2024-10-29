from typing import Optional

from pydantic import BaseModel


class ClusterEntity(BaseModel):
    """
    Model Config Entity.
    """

    name: str
    cluster_id: str
    displayName: str
    region: str
    spendingLimit: Optional[int] = 1000
    version: str
    createdBy: str
