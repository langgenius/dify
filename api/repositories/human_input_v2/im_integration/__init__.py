"""SQLAlchemy persistence adapters for the IM Control Plane domain."""

from .repository import SQLAlchemyIMControlPlaneRepository

__all__ = [
    "SQLAlchemyIMControlPlaneRepository",
]
