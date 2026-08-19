"""Apply Redis-backed category ordering for DB-backed Explore apps."""

import json
import logging
from collections.abc import Collection
from typing import Any

from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)

EXPLORE_APP_CATEGORY_ORDER_KEY_PREFIX = "explore:apps:category_order"


def _category_order_key(language: str) -> str:
    return f"{EXPLORE_APP_CATEGORY_ORDER_KEY_PREFIX}:{language}"


def get_explore_app_category_order(language: str) -> list[str]:
    try:
        raw_categories = redis_client.get(_category_order_key(language))
    except Exception:
        logger.exception("Failed to read explore app category order from Redis.")
        return []

    if not raw_categories:
        return []

    if isinstance(raw_categories, bytes):
        raw_categories = raw_categories.decode("utf-8")

    try:
        categories: Any = json.loads(raw_categories)
    except (TypeError, json.JSONDecodeError):
        logger.warning("Invalid explore app category order payload for language %s.", language)
        return []

    if not isinstance(categories, list):
        return []

    return [category for category in categories if isinstance(category, str)]


def order_categories(categories: Collection[str], language: str) -> list[str]:
    configured_order = get_explore_app_category_order(language)
    if configured_order:
        return configured_order

    return sorted(categories)
