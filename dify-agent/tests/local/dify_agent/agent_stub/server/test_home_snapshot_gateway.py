from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
import time
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from dify_agent.agent_stub.server.home_snapshots import (
    AsyncArchiveFile,
    HomeArchiveStore,
    HomeSnapshotGatewayService,
)
from dify_agent.agent_stub.server.router import create_agent_stub_router
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
from dify_agent.agent_stub.server.tokens.home_snapshot import (
    HOME_SNAPSHOT_SCOPE_READ,
    HOME_SNAPSHOT_SCOPE_WRITE,
    HomeSnapshotTransferTokenCodec,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.runtime_backend.errors import (
    HomeArchiveConflictError,
    HomeArchiveStoreError,
    HomeSnapshotNotFoundError,
)

_SNAPSHOT_REF = "home-snapshots/tenant-1/agent-1/snapshot-1.tar.zst"


def _secret() -> str:
    return base64.urlsafe_b64encode(b"s" * 32).rstrip(b"=").decode("ascii")


@dataclass(slots=True)
class _Archive:
    reads: list[bytes] = field(default_factory=list)
    writes: list[bytes] = field(default_factory=list)
    read_error: BaseException | None = None
    read_started: asyncio.Event | None = None
    read_release: asyncio.Event | None = None
    write_error: Exception | None = None
    close_error: BaseException | None = None
    close_calls: int = 0

    async def read(self, size: int | None = None) -> bytes:
        assert size == 1024 * 1024
        if self.read_started is not None:
            self.read_started.set()
            assert self.read_release is not None
            await asyncio.wait_for(self.read_release.wait(), timeout=1.0)
        if self.reads:
            return self.reads.pop(0)
        if self.read_error is not None:
            raise self.read_error
        return b""

    async def write(self, data: bytes) -> int:
        if self.write_error is not None:
            raise self.write_error
        self.writes.append(data)
        return len(data)

    async def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


@dataclass(slots=True)
class _Store:
    writer: _Archive = field(default_factory=_Archive)
    reader: _Archive = field(default_factory=lambda: _Archive(reads=[b"archive-", b"bytes"]))
    open_reader_error: Exception | None = None
    opened_writes: list[str] = field(default_factory=list)
    opened_reads: list[str] = field(default_factory=list)

    async def open_writer(self, snapshot_ref: str) -> AsyncArchiveFile:
        self.opened_writes.append(snapshot_ref)
        return self.writer

    async def open_reader(self, snapshot_ref: str) -> AsyncArchiveFile:
        self.opened_reads.append(snapshot_ref)
        if self.open_reader_error is not None:
            raise self.open_reader_error
        return self.reader


def _client(store: _Store) -> tuple[TestClient, HomeSnapshotTransferTokenCodec]:
    codec = HomeSnapshotTransferTokenCodec.from_server_secret(_secret())
    gateway = HomeSnapshotGatewayService(
        token_codec=codec,
        archive_store=cast(HomeArchiveStore, store),
    )
    app = FastAPI()
    app.include_router(create_agent_stub_router(token_codec=None, home_snapshot_gateway=gateway))
    return TestClient(app), codec


def test_home_snapshot_gateway_streams_upload_and_download_from_token_ref() -> None:
    store = _Store()
    client, codec = _client(store)
    write_token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_WRITE, snapshot_ref=_SNAPSHOT_REF)
    read_token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_READ, snapshot_ref=_SNAPSHOT_REF)

    upload = client.put(
        "/agent-stub/home-snapshots/archive?snapshot_ref=ignored",
        headers={"Authorization": f"Bearer {write_token}"},
        content=b"request-stream",
    )
    download = client.get(
        "/agent-stub/home-snapshots/archive?snapshot_ref=ignored",
        headers={"Authorization": f"Bearer {read_token}"},
    )

    assert upload.status_code == 204
    assert b"".join(store.writer.writes) == b"request-stream"
    assert store.writer.close_calls == 1
    assert store.opened_writes == [_SNAPSHOT_REF]
    assert download.status_code == 200
    assert download.content == b"archive-bytes"
    assert store.reader.close_calls == 1
    assert store.opened_reads == [_SNAPSHOT_REF]


def test_home_snapshot_gateway_rejects_scope_method_mismatch() -> None:
    client, codec = _client(_Store())
    read_token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_READ, snapshot_ref=_SNAPSHOT_REF)

    response = client.put(
        "/agent-stub/home-snapshots/archive",
        headers={"Authorization": f"Bearer {read_token}"},
        content=b"bytes",
    )

    assert response.status_code == 401


def test_home_snapshot_gateway_maps_missing_archive() -> None:
    store = _Store(open_reader_error=HomeSnapshotNotFoundError("snapshot is missing"))
    client, codec = _client(store)
    token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_READ, snapshot_ref=_SNAPSHOT_REF)

    response = client.get(
        "/agent-stub/home-snapshots/archive",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "snapshot is missing"}


def test_home_snapshot_gateway_maps_store_write_failure_and_closes_writer() -> None:
    store = _Store(writer=_Archive(write_error=HomeArchiveStoreError("store unavailable")))
    client, codec = _client(store)
    token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_WRITE, snapshot_ref=_SNAPSHOT_REF)

    response = client.put(
        "/agent-stub/home-snapshots/archive",
        headers={"Authorization": f"Bearer {token}"},
        content=b"archive",
    )

    assert response.status_code == 502
    assert response.json() == {"detail": "store unavailable"}
    assert store.writer.close_calls == 1


def test_home_snapshot_gateway_maps_conditional_conflict_reported_during_write() -> None:
    store = _Store(writer=_Archive(write_error=HomeArchiveConflictError("object exists")))
    client, codec = _client(store)
    token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_WRITE, snapshot_ref=_SNAPSHOT_REF)

    response = client.put(
        "/agent-stub/home-snapshots/archive",
        headers={"Authorization": f"Bearer {token}"},
        content=b"archive",
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "object exists"}
    assert store.writer.close_calls == 1


def test_home_snapshot_gateway_maps_conditional_conflict_reported_on_close() -> None:
    store = _Store(writer=_Archive(close_error=HomeArchiveConflictError("object exists")))
    client, codec = _client(store)
    token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_WRITE, snapshot_ref=_SNAPSHOT_REF)

    response = client.put(
        "/agent-stub/home-snapshots/archive",
        headers={"Authorization": f"Bearer {token}"},
        content=b"archive",
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "object exists"}
    assert store.writer.close_calls == 1


@pytest.mark.anyio
async def test_home_snapshot_gateway_propagates_writer_close_cancellation() -> None:
    store = _Store(writer=_Archive(close_error=asyncio.CancelledError()))
    codec = HomeSnapshotTransferTokenCodec.from_server_secret(_secret())
    gateway = HomeSnapshotGatewayService(
        token_codec=codec,
        archive_store=cast(HomeArchiveStore, store),
    )
    token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_WRITE, snapshot_ref=_SNAPSHOT_REF)

    async def chunks() -> AsyncIterator[bytes]:
        yield b"archive"

    with pytest.raises(asyncio.CancelledError):
        await gateway.upload(authorization=f"Bearer {token}", chunks=chunks())

    assert store.writer.close_calls == 1


@pytest.mark.parametrize(
    "request_error",
    (RuntimeError("request stream failed"), asyncio.CancelledError()),
    ids=("failure", "cancellation"),
)
@pytest.mark.anyio
async def test_home_snapshot_gateway_closes_writer_when_request_stream_stops(
    request_error: BaseException,
) -> None:
    store = _Store()
    codec = HomeSnapshotTransferTokenCodec.from_server_secret(_secret())
    gateway = HomeSnapshotGatewayService(
        token_codec=codec,
        archive_store=cast(HomeArchiveStore, store),
    )
    token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_WRITE, snapshot_ref=_SNAPSHOT_REF)

    async def chunks() -> AsyncIterator[bytes]:
        yield b"partial"
        raise request_error

    with pytest.raises(type(request_error)) as exc_info:
        await gateway.upload(authorization=f"Bearer {token}", chunks=chunks())

    assert exc_info.value is request_error
    assert store.writer.writes == [b"partial"]
    assert store.writer.close_calls == 1


@pytest.mark.anyio
async def test_home_snapshot_gateway_closes_reader_after_midstream_failure() -> None:
    read_error = RuntimeError("read failed")
    store = _Store(reader=_Archive(reads=[b"partial"], read_error=read_error))
    codec = HomeSnapshotTransferTokenCodec.from_server_secret(_secret())
    gateway = HomeSnapshotGatewayService(
        token_codec=codec,
        archive_store=cast(HomeArchiveStore, store),
    )
    token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_READ, snapshot_ref=_SNAPSHOT_REF)
    stream = await gateway.download(authorization=f"Bearer {token}")

    assert await anext(stream) == b"partial"
    with pytest.raises(RuntimeError, match="read failed") as exc_info:
        _ = await anext(stream)

    assert exc_info.value is read_error
    assert store.reader.close_calls == 1


@pytest.mark.anyio
async def test_home_snapshot_gateway_closes_reader_when_consumer_is_cancelled() -> None:
    read_started = asyncio.Event()
    read_release = asyncio.Event()
    store = _Store(
        reader=_Archive(
            reads=[b"unreachable"],
            read_started=read_started,
            read_release=read_release,
        )
    )
    codec = HomeSnapshotTransferTokenCodec.from_server_secret(_secret())
    gateway = HomeSnapshotGatewayService(
        token_codec=codec,
        archive_store=cast(HomeArchiveStore, store),
    )
    token = codec.encode_token(scope=HOME_SNAPSHOT_SCOPE_READ, snapshot_ref=_SNAPSHOT_REF)
    stream = await gateway.download(authorization=f"Bearer {token}")

    async def consume_one() -> bytes:
        return await anext(stream)

    consume = asyncio.create_task(consume_one())
    try:
        await asyncio.wait_for(read_started.wait(), timeout=1.0)
        consume.cancel()
        done, _ = await asyncio.wait({consume}, timeout=1.0)
        assert consume in done, "download stream ignored consumer cancellation"
        with pytest.raises(asyncio.CancelledError):
            _ = consume.result()
    finally:
        read_release.set()
        consume.cancel()
        done, _ = await asyncio.wait({consume}, timeout=1.0)
        if consume not in done:
            pytest.fail("download consumer task did not finish during bounded cleanup")
        if not consume.cancelled():
            _ = consume.exception()

    assert store.reader.close_calls == 1


def test_home_snapshot_gateway_rejects_ordinary_agent_stub_token() -> None:
    execution_context = DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        agent_mode="workflow_run",
        invoke_from="service-api",
    )
    ordinary_token = AgentStubTokenCodec.from_server_secret(_secret()).encode_connection_token(execution_context)
    client, _ = _client(_Store())

    response = client.get(
        "/agent-stub/home-snapshots/archive",
        headers={"Authorization": f"Bearer {ordinary_token}"},
    )

    assert response.status_code == 401


def test_ordinary_agent_stub_route_rejects_home_snapshot_transfer_token() -> None:
    transfer_codec = HomeSnapshotTransferTokenCodec.from_server_secret(_secret())
    transfer_token = transfer_codec.encode_token(
        scope=HOME_SNAPSHOT_SCOPE_READ,
        snapshot_ref=_SNAPSHOT_REF,
    )
    app = FastAPI()
    app.include_router(
        create_agent_stub_router(
            token_codec=AgentStubTokenCodec.from_server_secret(_secret()),
            home_snapshot_gateway=HomeSnapshotGatewayService(
                token_codec=transfer_codec,
                archive_store=cast(HomeArchiveStore, _Store()),
            ),
        )
    )

    response = TestClient(app).post(
        "/agent-stub/connections",
        headers={"Authorization": f"Bearer {transfer_token}"},
        json={"protocol_version": 1, "argv": []},
    )

    assert response.status_code == 401


def test_home_snapshot_transfer_token_rejects_expiration() -> None:
    codec = HomeSnapshotTransferTokenCodec.from_server_secret(_secret())
    token = codec.encode_token(
        scope=HOME_SNAPSHOT_SCOPE_READ,
        snapshot_ref=_SNAPSHOT_REF,
        now=int(time.time()) - 601,
    )

    client, _ = _client(_Store())
    response = client.get(
        "/agent-stub/home-snapshots/archive",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401


def test_home_snapshot_routes_return_503_without_gateway() -> None:
    app = FastAPI()
    app.include_router(create_agent_stub_router(token_codec=None))
    client = TestClient(app)

    assert client.put("/agent-stub/home-snapshots/archive", content=b"bytes").status_code == 503
    assert client.get("/agent-stub/home-snapshots/archive").status_code == 503
