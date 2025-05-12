from sqlalchemy.orm import declarative_base

from models.engine import metadata

Base = declarative_base(metadata=metadata)
