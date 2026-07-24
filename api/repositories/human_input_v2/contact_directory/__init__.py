"""SQLAlchemy mapping and transactions for the Contact Directory aggregate.

This package may depend on domain and ORM modules. It hides records, sessions,
owner predicates, locking, and rollback from domain and application callers.
"""

from .repository import SQLAlchemyContactDirectoryRepository

__all__ = ["SQLAlchemyContactDirectoryRepository"]
