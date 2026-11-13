from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import select

from extensions.ext_database import db
from models.dataset import RateLimitLog
from services import knowledge_rate_limit_service
from services.entities.feature_entities import KnowledgeRateLimitModel
from services.feature_service import FeatureService
from services.knowledge_rate_limit_service import KnowledgeRateLimitExceededError, enforce_knowledge_rate_limit


def test_requests_in_the_same_millisecond_are_counted_independently(
    flask_app_with_containers: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A second same-millisecond request exceeds a one-request rolling limit."""
    tenant_id = str(uuid4())

    def rate_limit_for_tenant(requested_tenant_id: str) -> KnowledgeRateLimitModel:
        assert requested_tenant_id == tenant_id
        return KnowledgeRateLimitModel(enabled=True, limit=1, subscription_plan="professional")

    monkeypatch.setattr(
        FeatureService,
        "get_knowledge_rate_limit",
        staticmethod(rate_limit_for_tenant),
    )
    current_time = 1_800_000_000.125

    with flask_app_with_containers.app_context():
        with monkeypatch.context() as time_patch:
            time_patch.setattr(knowledge_rate_limit_service.time, "time", lambda: current_time)
            enforce_knowledge_rate_limit(tenant_id)
            with pytest.raises(KnowledgeRateLimitExceededError):
                enforce_knowledge_rate_limit(tenant_id)

        logs = db.session.scalars(select(RateLimitLog).where(RateLimitLog.tenant_id == tenant_id)).all()
        assert len(logs) == 1
        assert logs[0].operation == "knowledge"
