"""Translate workflow knowledge retrieval failures at HTTP transport boundaries.

Shared by every endpoint that runs ``InnerKnowledgeRetrievalService`` so callers
see the same error codes regardless of how they authenticate.
"""

from collections.abc import Generator
from contextlib import contextmanager

from core.workflow.nodes.knowledge_retrieval import exc as retrieval_exc
from libs.exception import BaseHTTPException
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError, InnerKnowledgeRetrievalServiceError


class KnowledgeRetrievalHttpError(BaseHTTPException):
    error_code = "knowledge_retrieve_failed"
    description = "Knowledge retrieval failed."
    code = 500

    def __init__(
        self,
        *,
        error_code: str | None = None,
        description: str | None = None,
        status_code: int | None = None,
    ) -> None:
        if error_code is not None:
            self.error_code = error_code
        if description is not None:
            self.description = description
        if status_code is not None:
            self.code = status_code
        super().__init__(self.description)


@contextmanager
def knowledge_retrieval_errors() -> Generator[None]:
    try:
        yield
    except InnerKnowledgeRetrievalServiceError as exc:
        raise KnowledgeRetrievalHttpError(
            error_code=exc.error_code,
            description=exc.description,
            status_code=exc.status_code,
        ) from exc
    except retrieval_exc.RateLimitExceededError as exc:
        raise KnowledgeRetrievalHttpError(
            error_code="knowledge_rate_limited",
            description=str(exc),
            status_code=429,
        ) from exc
    except ExternalKnowledgeRetrievalError as exc:
        raise KnowledgeRetrievalHttpError(
            error_code="external_knowledge_failed",
            description=str(exc),
            status_code=502,
        ) from exc
    except ValueError as exc:
        # Must stay last: the errors above are ValueError subclasses.
        raise KnowledgeRetrievalHttpError(
            error_code="retrieval_config_invalid",
            description=str(exc),
            status_code=422,
        ) from exc
