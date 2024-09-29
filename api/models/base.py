from sqlalchemy.orm import declarative_base

from extensions.ext_database import metadata

Base = declarative_base(metadata=metadata)
