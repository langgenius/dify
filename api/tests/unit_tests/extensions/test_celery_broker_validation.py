"""Unit tests for the Celery broker URL cluster guard in ``ext_celery``.

Kombu's redis transport does not support Redis Cluster — BRPOP's
multi-queue blocking pop, ETA ZSets, and the unacked Hash all assume a
single slot. If an operator points ``CELERY_BROKER_URL`` or
``CELERY_RESULT_BACKEND`` at ``redis+cluster://``, the app would start
successfully and only crash on the first task enqueue with an opaque
Kombu error (MOVED redirect, unroutable key, etc.). We catch it at
startup instead.
"""

import pytest

from extensions.ext_celery import _reject_cluster_broker_url


class TestRejectClusterBrokerURL:
    def test_plain_redis_broker_is_allowed(self) -> None:
        _reject_cluster_broker_url(
            broker_url="redis://:pw@redis:6379/0",
            backend_url="redis://:pw@redis:6379/1",
        )

    def test_sentinel_broker_is_allowed(self) -> None:
        _reject_cluster_broker_url(
            broker_url="sentinel://sentinel-a:26379;sentinel-b:26379",
            backend_url=None,
        )

    def test_none_urls_are_allowed(self) -> None:
        _reject_cluster_broker_url(broker_url=None, backend_url=None)

    def test_redis_cluster_broker_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="CELERY_BROKER_URL"):
            _reject_cluster_broker_url(
                broker_url="redis+cluster://:pw@n1:7001,n2:7002",
                backend_url=None,
            )

    def test_rediss_cluster_broker_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="CELERY_BROKER_URL"):
            _reject_cluster_broker_url(
                broker_url="rediss+cluster://:pw@n1:7001",
                backend_url=None,
            )

    def test_cluster_broker_is_rejected_case_insensitive(self) -> None:
        with pytest.raises(ValueError, match="CELERY_BROKER_URL"):
            _reject_cluster_broker_url(
                broker_url="REDIS+CLUSTER://:pw@n1:7001",
                backend_url=None,
            )

    def test_cluster_result_backend_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="CELERY_RESULT_BACKEND"):
            _reject_cluster_broker_url(
                broker_url="redis://:pw@redis:6379/0",
                backend_url="redis+cluster://:pw@n1:7001",
            )

    def test_sentinel_broker_with_cluster_backend_is_rejected(self) -> None:
        # Mixed config: broker is Sentinel (allowed) but backend is
        # Cluster (not). The validator must still flag the backend.
        with pytest.raises(ValueError, match="CELERY_RESULT_BACKEND"):
            _reject_cluster_broker_url(
                broker_url="sentinel://s1:26379;s2:26379",
                backend_url="redis+cluster://:pw@n1:7001",
            )

    def test_whitespace_wrapped_cluster_broker_is_rejected(self) -> None:
        # A YAML quoting slip may leave leading / trailing whitespace on
        # the URL. Strip before scheme-matching so the validator catches
        # it (otherwise it falls through to Kombu's URL parser and a
        # less actionable failure).
        with pytest.raises(ValueError, match="CELERY_BROKER_URL"):
            _reject_cluster_broker_url(
                broker_url="  redis+cluster://:pw@n1:7001  ",
                backend_url=None,
            )

    def test_rejection_message_names_kombu_and_recommends_alternatives(self) -> None:
        with pytest.raises(ValueError) as exc_info:
            _reject_cluster_broker_url(
                broker_url="redis+cluster://n1:7001",
                backend_url=None,
            )
        message = str(exc_info.value)
        assert "Kombu" in message
        assert "standalone" in message.lower() or "sentinel" in message.lower()
