import hashlib
from dataclasses import dataclass, field, replace
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
    reads: list[str] = field(default_factory=list)

    def setex(self, name: str, time: timedelta, value: str) -> bool:
        self.data[name] = value
        self.ttls[name] = time
        return True

    def getdel(self, name: str) -> str | bytes | None:
        self.reads.append(name)
        return self.data.pop(name, None)


def _repo(fake: FakeRedis) -> RedisAuthorizationCodeRepository:
    return RedisAuthorizationCodeRepository(fake)


def test_consume_returns_record_once() -> None:
    fake = FakeRedis()
    repo = _repo(fake)
    code = repo.save(RECORD, timedelta(seconds=600))

    assert repo.consume(code) == RECORD
    assert repo.consume(code) is None


def test_save_stores_under_hashed_namespaced_key_with_ttl() -> None:
    fake = FakeRedis()
    code = _repo(fake).save(RECORD, timedelta(seconds=90))

    expected_key = f"openapi_oauth:authorization_code:{hashlib.sha256(code.encode()).hexdigest()}"
    assert list(fake.data) == [expected_key]
    assert code not in expected_key
    assert fake.ttls[expected_key] == timedelta(seconds=90)


def test_codes_are_unique() -> None:
    repo = _repo(FakeRedis())

    assert repo.save(RECORD, timedelta(seconds=60)) != repo.save(RECORD, timedelta(seconds=60))


def test_unknown_code_returns_none() -> None:
    assert _repo(FakeRedis()).consume("nope") is None


def test_legacy_provider_keys_are_never_read() -> None:
    fake = FakeRedis(data={"oauth_provider:difyctl:authorization_code:abc": "acc-1"})

    assert _repo(fake).consume("abc") is None
    assert all(key.startswith("openapi_oauth:authorization_code:") for key in fake.reads)
    assert "oauth_provider:difyctl:authorization_code:abc" in fake.data


def test_malformed_stored_values_return_none() -> None:
    fake = FakeRedis()
    repo = _repo(fake)
    for raw in ["not json", "[]", "null", '{"client_id": "x"}', b"\xff\xfe", '{"client_id": 1}']:
        fake.data.clear()
        code = repo.save(RECORD, timedelta(seconds=60))
        key = next(iter(fake.data))
        fake.data[key] = raw
        assert repo.consume(code) is None


def test_bytes_value_from_real_redis_is_accepted() -> None:
    fake = FakeRedis()
    repo = _repo(fake)
    code = repo.save(RECORD, timedelta(seconds=60))
    key = next(iter(fake.data))
    value = fake.data[key]
    assert isinstance(value, str)
    fake.data[key] = value.encode()

    assert repo.consume(code) == RECORD


def test_null_scope_round_trips() -> None:
    fake = FakeRedis()
    repo = _repo(fake)
    record = replace(RECORD, scope=None)

    assert repo.consume(repo.save(record, timedelta(seconds=60))) == record
