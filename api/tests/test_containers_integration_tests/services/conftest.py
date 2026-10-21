"""Explicit persistence dependencies for knowledge service integration tests."""

import pytest
from sqlalchemy.orm import Session, sessionmaker

from repositories.knowledge.external_repository import SQLAlchemyExternalKnowledgeRepository
from services.knowledge.dataset_service import ExternalKnowledgeTemplateLookup


@pytest.fixture
def external_templates(db_session_with_containers: Session) -> ExternalKnowledgeTemplateLookup:
    return SQLAlchemyExternalKnowledgeRepository(
        session_factory=sessionmaker(bind=db_session_with_containers.get_bind())
    )
