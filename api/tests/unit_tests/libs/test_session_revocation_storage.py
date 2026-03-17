from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from libs.session_revocation_storage import (
    NullSessionRevocationStorage,
    RedisSessionRevocationStorage,
    get_session_revocation_storage,
)


class TestSessionRevocationStorage:
    def test_null_storage_behaviour(self):
        s = NullSessionRevocationStorage()
        s.revoke("any", datetime.now(UTC) + timedelta(hours=1))
        assert s.is_revoked("any") is False
        s.expunge()

    def test_redis_storage_revoke_sets_ttl_and_is_revoked_true(self):
        mock_redis = MagicMock()
        storage = RedisSessionRevocationStorage()

        token_id = "jti-abc"
        exp = datetime.now(UTC) + timedelta(hours=1)

        with patch("libs.session_revocation_storage.redis_client", mock_redis):
            storage.revoke(token_id, exp)
            assert mock_redis.setex.called
            key, ttl, value = mock_redis.setex.call_args[0]
            assert key == f"passport:blacklist:jti:{token_id}"
            assert 3500 <= int(ttl) <= 3600
            assert value in (b"1", "1")

            mock_redis.exists.return_value = True
            assert storage.is_revoked(token_id) is True

    def test_factory_returns_null_by_default_and_redis_when_configured(self):
        import libs.session_revocation_storage as srs

        srs._singleton = None
        with patch("libs.session_revocation_storage.dify_config") as cfg:
            cfg.SESSION_REVOCATION_STORAGE = ""
            inst = get_session_revocation_storage()
            assert isinstance(inst, NullSessionRevocationStorage)

        srs._singleton = None
        with patch("libs.session_revocation_storage.dify_config") as cfg:
            cfg.SESSION_REVOCATION_STORAGE = "redis"
            inst = get_session_revocation_storage()
            assert isinstance(inst, RedisSessionRevocationStorage)
