"""Database failures of the tracing repositories, reported as the tracing slice's error."""

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy.exc import SQLAlchemyError

from services.tracing.errors import TracingStoreUnavailableError


@contextmanager
def tracing_store_errors() -> Generator[None]:
    try:
        yield
    except SQLAlchemyError as error:
        raise TracingStoreUnavailableError from error
