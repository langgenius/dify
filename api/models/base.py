from typing import Annotated

from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.types import String

from models.engine import metadata

str50 = Annotated[str, 50]


class Base(DeclarativeBase):
    metadata = metadata
    type_annotation_map = {
        str50: String(50),
    }
