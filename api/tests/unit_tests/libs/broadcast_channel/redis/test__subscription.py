"""Exercise subscription failure through a real Redis client and socket transport."""

import socket
import threading

import pytest
from redis import Connection, Redis
from redis.backoff import NoBackoff
from redis.retry import Retry

from libs.broadcast_channel.exc import SubscriptionClosedError
from libs.broadcast_channel.redis.pubsub_channel import _RedisSubscription


def test_listener_disconnect_closes_subscription_and_unblocks_receive(monkeypatch: pytest.MonkeyPatch) -> None:
    client_socket, server_socket = socket.socketpair()
    client_socket.settimeout(1)
    server_socket.settimeout(2)

    def connect(_connection: Connection) -> socket.socket:
        return client_socket

    monkeypatch.setattr(Connection, "_connect", connect)
    client = Redis(retry=Retry(NoBackoff(), 0))
    pubsub = client.pubsub()
    subscription = _RedisSubscription(client=client, pubsub=pubsub, topic="topic")
    received_close = threading.Event()
    finished = threading.Event()
    errors: list[Exception] = []

    def receive() -> None:
        try:
            subscription.receive(timeout=None)
        except SubscriptionClosedError:
            received_close.set()
        except Exception as error:
            errors.append(error)
        finally:
            finished.set()

    receiver = threading.Thread(target=receive, daemon=True)
    try:
        receiver.start()
        with server_socket.makefile("rb") as incoming:

            def read_command() -> list[bytes]:
                header = incoming.readline()
                assert header.startswith(b"*")
                parts: list[bytes] = []
                for _ in range(int(header[1:])):
                    size = incoming.readline()
                    assert size.startswith(b"$")
                    parts.append(incoming.read(int(size[1:])))
                    assert incoming.read(2) == b"\r\n"
                return parts

            command = read_command()
            while command[0] == b"CLIENT":
                server_socket.sendall(b"+OK\r\n")
                command = read_command()
            assert command == [b"SUBSCRIBE", b"topic"]
        server_socket.sendall(b"*3\r\n$9\r\nsubscribe\r\n$5\r\ntopic\r\n:1\r\n")
        server_socket.close()

        assert finished.wait(2), "A disconnected listener must wake a blocking receiver"
        assert received_close.is_set()
        assert errors == []
        listener = subscription._listener_thread
        assert listener is not None
        listener.join(timeout=2)
        assert not listener.is_alive()
        assert pubsub.connection is None
        assert list(subscription) == []
        with pytest.raises(SubscriptionClosedError):
            subscription.receive(timeout=0)
    finally:
        subscription.close()
        pubsub.close()
        client.close()
        server_socket.close()
        client_socket.close()
        receiver.join(timeout=2)
