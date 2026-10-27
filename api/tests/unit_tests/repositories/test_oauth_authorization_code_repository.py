import hashlib
from dataclasses import dataclass, field
from datetime import timedelta

from repositories.oauth_authorization_code_repository import (
    AuthorizationCodeRecord,
    RedisAuthorizationCodeRepository,
)

RECORD = AuthorizationCodeRecord(
    client_id="difyctl",
    redirect_uri="http://127.0.0.1:5/cb",
    code_challenge="c" * 43,
    resource="https://dify.example.com/openapi/v1",
    scope="apps:run",
    account_id="acc-1",
    workspace_id="ws-1",
)


@dataclass
class FakeRedis:
    data: dict[str, str | bytes] = field(default_factory=dict)
    ttls: dict[str, timedelta] = field(default_factory=dict)

    def setex(self, name: str, time: timedelta, value: str) -> bool:
        self.data[name] = value
        self.ttls[name] = time
        return True

    def getdel(self, name: str) -> str | bytes | None:
        return self.data.pop(name, None)


def test_consume_returns_record_once() -> None:
    repo = RedisAuthorizationCodeRepository(FakeRedis())
    code = repo.save(RECORD, timedelta(seconds=600))

    assert repo.consume(code) == RECORD
    assert repo.consume(code) is None
    assert repo.consume("nope") is None


def test_save_stores_under_hashed_namespaced_key_with_ttl() -> None:
    fake = FakeRedis()
    code = RedisAuthorizationCodeRepository(fake).save(RECORD, timedelta(seconds=90))

    expected_key = f"openapi_oauth:authorization_code:{hashlib.sha256(code.encode()).hexdigest()}"
    assert list(fake.data) == [expected_key]
    assert code not in expected_key
    assert fake.ttls[expected_key] == timedelta(seconds=90)


def test_bytes_values_parse_and_malformed_values_return_none() -> None:
    fake = FakeRedis()
    repo = RedisAuthorizationCodeRepository(fake)
    code = repo.save(RECORD, timedelta(seconds=60))
    key = next(iter(fake.data))
    stored = fake.data[key]
    assert isinstance(stored, str)

    for raw, expected in [(stored.encode(), RECORD), ('{"client_id": "x"}', None)]:
        fake.data[key] = raw
        assert repo.consume(code) == expected
