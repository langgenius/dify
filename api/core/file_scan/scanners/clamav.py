import socket
import struct
from collections.abc import Mapping
from typing import Any, ClassVar, override

from core.file_scan.base import FileScanner, ScannerConfigError, ScannerError
from core.file_scan.entities import ScanProblem, ScanProviderType, ScanTarget, ScanVerdict

CHUNK_SIZE = 64 * 1024
MAX_REPLY_BYTES = 4096


class ClamAVScanner(FileScanner):
    """clamd over TCP, using ``INSTREAM``.

    The address comes from deployment configuration, never from a workspace: raw TCP cannot go
    through the SSRF proxy, so a tenant-supplied host would reach the internal network.
    """

    provider_type: ClassVar[ScanProviderType] = ScanProviderType.CLAMAV

    @classmethod
    @override
    def validate_settings(cls, credentials: Mapping[str, str], config: Mapping[str, Any]) -> None:
        if not config.get("host"):
            raise ScannerConfigError("ClamAV is not configured for this deployment")

    def _connect(self) -> socket.socket:
        timeout = self.request_timeout
        try:
            connection = socket.create_connection(
                (str(self.config["host"]), int(self.config.get("port") or 3310)), timeout=min(timeout, 10.0)
            )
        except TimeoutError as error:
            raise ScannerError(ScanProblem.TIMEOUT, "connection timed out") from error
        except OSError as error:
            raise ScannerError(ScanProblem.NETWORK, type(error).__name__) from error
        connection.settimeout(timeout)
        return connection

    def _command(self, command: bytes, body: bytes | None = None) -> str:
        try:
            with self._connect() as connection:
                connection.sendall(command)
                if body is not None:
                    for start in range(0, len(body), CHUNK_SIZE):
                        chunk = body[start : start + CHUNK_SIZE]
                        connection.sendall(struct.pack("!I", len(chunk)) + chunk)
                    connection.sendall(struct.pack("!I", 0))
                reply = bytearray()
                while len(reply) < MAX_REPLY_BYTES:
                    received = connection.recv(MAX_REPLY_BYTES - len(reply))
                    if not received:
                        break
                    reply.extend(received)
                    if b"\0" in received:
                        break
        except ScannerError:
            raise
        except TimeoutError as error:
            raise ScannerError(ScanProblem.TIMEOUT, "clamd timed out") from error
        except OSError as error:
            # clamd closes the connection when the stream exceeds StreamMaxLength; the reply, when
            # it arrives, says so. A reset without a reply is reported as a network failure.
            raise ScannerError(ScanProblem.NETWORK, type(error).__name__) from error
        return reply.split(b"\0", 1)[0].decode("utf-8", errors="replace").strip()

    @override
    def _scan(self, target: ScanTarget, *, external_id: str | None) -> ScanVerdict:
        reply = self._command(b"zINSTREAM\0", target.load())
        engine = "ClamAV"
        if reply.endswith("OK"):
            return ScanVerdict.clean(engine=engine)
        if reply.endswith("FOUND"):
            name = reply.removeprefix("stream:").removesuffix("FOUND").strip()
            return ScanVerdict.infected([name or "unknown"], engine=engine)
        if "size limit exceeded" in reply.lower():
            return ScanVerdict.unscannable(ScanProblem.TOO_LARGE)
        raise ScannerError(ScanProblem.INVALID_RESPONSE, reply[:200] or "empty reply")

    @override
    def check(self) -> None:
        if self._command(b"zPING\0") != "PONG":
            raise ScannerError(ScanProblem.INVALID_RESPONSE, "clamd did not answer PING")
        super().check()
