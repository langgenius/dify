from sqlalchemy.orm import declarative_base

from models.engine import db, metadata

Base = declarative_base(metadata=metadata)
Base.query = db.session.query_property()
