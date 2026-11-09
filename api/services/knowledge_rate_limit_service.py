"""Cloud knowledge request quota and audit persistence."""

import time

from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import RateLimitLog
from services.feature_service import FeatureService


class KnowledgeRateLimitExceededError(Exception):
    """The workspace has exhausted its knowledge request quota."""


def enforce_knowledge_rate_limit(tenant_id: str) -> None:
    knowledge_rate_limit = FeatureService.get_knowledge_rate_limit(tenant_id)
    if not knowledge_rate_limit.enabled:
        return

    current_time = int(time.time() * 1000)
    key = f"rate_limit_{tenant_id}"

    redis_client.zadd(key, {current_time: current_time})

    redis_client.zremrangebyscore(key, 0, current_time - 60000)

    request_count = redis_client.zcard(key)

    if request_count > knowledge_rate_limit.limit:
        # add ratelimit record
        rate_limit_log = RateLimitLog(
            tenant_id=tenant_id,
            subscription_plan=knowledge_rate_limit.subscription_plan,
            operation="knowledge",
        )
        with sessionmaker(bind=db.engine, expire_on_commit=False).begin() as session:
            session.add(rate_limit_log)
        raise KnowledgeRateLimitExceededError(
            "Sorry, you have reached the knowledge base request rate limit of your subscription."
        )
