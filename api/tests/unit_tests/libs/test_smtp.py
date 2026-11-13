import smtplib
import socket
import ssl
import threading
from datetime import UTC, datetime, timedelta
from email import policy
from email.parser import BytesParser
from pathlib import Path
from types import TracebackType
from unittest.mock import ANY, MagicMock, patch

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from configs import dify_config
from libs.smtp import SMTPClient


def _mail() -> dict[str, str]:
    return {"to": "user@example.com", "subject": "Hi", "html": "<b>Hi</b>"}


@patch("libs.smtp.smtplib.SMTP", autospec=True)
def test_smtp_plain_success(mock_smtp_cls: MagicMock) -> None:
    mock_smtp = mock_smtp_cls.return_value
    client = SMTPClient(server="smtp.example.com", port=25, username="", password="", _from="noreply@example.com")
    client.send(_mail())

    mock_smtp_cls.assert_called_once_with("smtp.example.com", 25, timeout=10, local_hostname=ANY)
    mock_smtp.sendmail.assert_called_once()
    mock_smtp.quit.assert_called_once()


@patch("libs.smtp.smtplib.SMTP", autospec=True)
def test_smtp_tls_opportunistic_success(mock_smtp_cls: MagicMock) -> None:
    mock_smtp = mock_smtp_cls.return_value
    client = SMTPClient(
        server="smtp.example.com",
        port=587,
        username="user",
        password="pass",
        _from="noreply@example.com",
        use_tls=True,
        opportunistic_tls=True,
    )
    client.send(_mail())

    mock_smtp_cls.assert_called_once_with("smtp.example.com", 587, timeout=10, local_hostname=ANY)
    assert mock_smtp.ehlo.call_count == 2
    mock_smtp.starttls.assert_called_once()
    mock_smtp.login.assert_called_once_with("user", "pass")
    mock_smtp.sendmail.assert_called_once()
    mock_smtp.quit.assert_called_once()


@patch("libs.smtp.smtplib.SMTP_SSL", autospec=True)
def test_smtp_tls_ssl_branch_and_timeout(mock_smtp_ssl_cls: MagicMock) -> None:
    # Cover SMTP_SSL branch and TimeoutError handling
    mock_smtp = MagicMock()
    mock_smtp.sendmail.side_effect = TimeoutError("timeout")
    mock_smtp_ssl_cls.return_value = mock_smtp

    client = SMTPClient(
        server="smtp.example.com",
        port=465,
        username="",
        password="",
        _from="noreply@example.com",
        use_tls=True,
        opportunistic_tls=False,
    )
    with pytest.raises(TimeoutError):
        client.send(_mail())
    mock_smtp.quit.assert_called_once()


@patch("libs.smtp.smtplib.SMTP", autospec=True)
def test_smtp_generic_exception_propagates(mock_smtp_cls: MagicMock) -> None:
    mock_smtp = MagicMock()
    mock_smtp.sendmail.side_effect = RuntimeError("oops")
    mock_smtp_cls.return_value = mock_smtp

    client = SMTPClient(server="smtp.example.com", port=25, username="", password="", _from="noreply@example.com")
    with pytest.raises(RuntimeError):
        client.send(_mail())
    mock_smtp.quit.assert_called_once()


@patch("libs.smtp.smtplib.SMTP", autospec=True)
def test_smtp_smtplib_exception_in_login(mock_smtp_cls: MagicMock) -> None:
    # Ensure we hit the specific SMTPException except branch
    import smtplib

    mock_smtp = MagicMock()
    mock_smtp.login.side_effect = smtplib.SMTPException("login-fail")
    mock_smtp_cls.return_value = mock_smtp

    client = SMTPClient(
        server="smtp.example.com",
        port=25,
        username="user",  # non-empty to trigger login
        password="pass",
        _from="noreply@example.com",
    )
    with pytest.raises(smtplib.SMTPException):
        client.send(_mail())
    mock_smtp.quit.assert_called_once()


@pytest.mark.parametrize("use_tls", [False, True])
@pytest.mark.parametrize(
    "send_error_type",
    [
        None,
        smtplib.SMTPDataError,
        TimeoutError,
        RuntimeError,
    ],
)
@pytest.mark.parametrize("close_fails", [False, True])
def test_smtp_cleanup_preserves_send_result(
    use_tls: bool,
    send_error_type: type[Exception] | None,
    close_fails: bool,
    caplog: pytest.LogCaptureFixture,
) -> None:
    send_error: Exception | None = None
    if send_error_type is smtplib.SMTPDataError:
        send_error = smtplib.SMTPDataError(451, b"temporary send failure")
    elif send_error_type is not None:
        send_error = send_error_type("send failed")

    smtp_class = "libs.smtp.smtplib.SMTP_SSL" if use_tls else "libs.smtp.smtplib.SMTP"
    with patch(smtp_class, autospec=True) as mock_smtp_cls:
        mock_smtp = mock_smtp_cls.return_value
        mock_smtp.sendmail.side_effect = send_error
        mock_smtp.quit.side_effect = smtplib.SMTPServerDisconnected("connection lost during QUIT")
        if close_fails:
            mock_smtp.close.side_effect = OSError("close failed")
        client = SMTPClient(
            server="smtp.example.com",
            port=465 if use_tls else 25,
            username="",
            password="",
            _from="noreply@example.com",
            use_tls=use_tls,
        )

        if send_error is None:
            assert client.send(_mail()) is None
        else:
            with pytest.raises(type(send_error)) as exc_info:
                client.send(_mail())
            assert exc_info.value is send_error

        mock_smtp.sendmail.assert_called_once()
        mock_smtp.quit.assert_called_once()
        mock_smtp.close.assert_called_once()
        assert "Failed to quit SMTP connection" in caplog.text
        if close_fails:
            assert "Failed to close SMTP connection" in caplog.text


@pytest.fixture
def smtp_tls_context(tmp_path: Path) -> ssl.SSLContext:
    """Create an ephemeral loopback server certificate without external tools or services."""
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    cert_path, key_path = tmp_path / "cert.pem", tmp_path / "key.pem"
    cert_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_path, key_path)
    return context


class _SMTPRelay:
    """Accept one local SMTP connection; retain wire commands and propagate server failures."""

    def __init__(
        self,
        context: ssl.SSLContext,
        mode: str,
        *,
        hostname: str | None = None,
        reject_at: str | None = None,
        fail_quit: bool = False,
    ) -> None:
        self.context, self.mode, self.hostname = context, mode, hostname
        self.reject_at, self.fail_quit = reject_at, fail_quit
        self.commands: list[str] = []
        self.messages: list[bytes] = []
        self.errors: list[Exception] = []
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.listener.settimeout(5)
        self.port = self.listener.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)

    def __enter__(self) -> "_SMTPRelay":
        """Start a single bounded loopback receiver before returning its address."""
        self.thread.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Close and join the receiver; never leave a failed server hidden in a thread."""
        self.thread.join(timeout=6)
        self.listener.close()
        assert not self.thread.is_alive(), "SMTP receiver did not stop"
        assert not self.errors, self.errors

    def _serve(self) -> None:
        """Perform real SMTP/TLS and envelope exchanges for one test client."""
        connection = None
        reader = None
        try:
            connection, _ = self.listener.accept()
            connection.settimeout(5)
            if self.mode == "ssl":
                connection = self.context.wrap_socket(connection, server_side=True)
            reader = connection.makefile("rb")
            connection.sendall(b"220 loopback ESMTP\r\n")
            identity, finished = "", False
            secure = self.mode == "ssl"
            while not finished:
                line = reader.readline()
                if not line:
                    raise EOFError("SMTP client disconnected before QUIT")
                command = line.decode("ascii").rstrip("\r\n")
                self.commands.append(command)
                verb, _, argument = command.partition(" ")
                match verb.upper():
                    case "EHLO":
                        identity = argument
                        connection.sendall(
                            b"250-loopback\r\n250 AUTH PLAIN\r\n"
                            if secure
                            else b"250-loopback\r\n250-AUTH PLAIN\r\n250 STARTTLS\r\n"
                        )
                    case "STARTTLS":
                        if self.reject_at == "starttls":
                            connection.sendall(b"454 TLS unavailable\r\n")
                        else:
                            connection.sendall(b"220 Ready for TLS\r\n")
                            reader.close()
                            connection = self.context.wrap_socket(connection, server_side=True)
                            reader = connection.makefile("rb")
                            identity = ""
                            secure = True
                    case "AUTH":
                        connection.sendall(
                            b"535 Authentication failed\r\n" if self.reject_at == "auth" else b"235 Authenticated\r\n"
                        )
                    case "MAIL":
                        refused = self.reject_at == "mail" or (self.hostname is not None and identity != self.hostname)
                        connection.sendall(b"550 Sender identity rejected\r\n" if refused else b"250 Sender OK\r\n")
                    case "RCPT" | "RSET":
                        connection.sendall(b"250 OK\r\n")
                    case "DATA":
                        if self.reject_at == "data":
                            connection.sendall(b"554 Message rejected\r\n")
                        else:
                            connection.sendall(b"354 End with dot\r\n")
                            body = bytearray()
                            part = reader.readline()
                            while part not in (b".\r\n", b""):
                                body.extend(part)
                                part = reader.readline()
                            if not part:
                                raise EOFError("SMTP client disconnected during DATA")
                            self.messages.append(bytes(body))
                            connection.sendall(b"250 Queued locally\r\n")
                    case "QUIT":
                        if not self.fail_quit:
                            connection.sendall(b"221 Bye\r\n")
                        finished = True
                    case _:
                        raise ValueError(f"Unexpected SMTP command: {verb}")
        except Exception as exc:
            self.errors.append(exc)
        finally:
            if reader is not None:
                reader.close()
            if connection is not None:
                connection.close()


def _relay_client(relay: _SMTPRelay, *, username: str = "", password: str = "") -> SMTPClient:
    """Use the real adapter against the receiver; all envelope addresses are test-only."""
    return SMTPClient(
        "127.0.0.1",
        relay.port,
        username,
        password,
        "sender@example.invalid",
        use_tls=relay.mode != "plain",
        opportunistic_tls=relay.mode == "starttls",
    )


@pytest.mark.parametrize("mode", ["plain", "starttls", "ssl"])
@pytest.mark.parametrize("hostname", [None, "", "dify.test.invalid"])
def test_real_smtp_preserves_local_hostname(
    mode: str, hostname: str | None, smtp_tls_context: ssl.SSLContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    """All transport modes use the configured/default identity and preserve message content."""
    monkeypatch.setattr(dify_config, "SMTP_LOCAL_HOSTNAME", hostname)
    expected = hostname or smtplib.SMTP().local_hostname
    with _SMTPRelay(smtp_tls_context, mode, hostname=expected) as relay:
        assert _relay_client(relay).send(_mail()) is None
    greetings = [line for line in relay.commands if line.startswith("ehlo ")]
    assert greetings == [f"ehlo {expected}"] * (2 if mode == "starttls" else 1)
    if mode == "starttls":
        assert relay.commands[:3] == [f"ehlo {expected}", "STARTTLS", f"ehlo {expected}"]
    else:
        assert "STARTTLS" not in relay.commands
    assert relay.commands[-1] == "quit"
    assert len(relay.messages) == 1
    message = BytesParser(policy=policy.default).parsebytes(relay.messages[0])
    assert message["Subject"] == "Hi"
    assert message["From"] == "sender@example.invalid"
    assert message["To"] == "user@example.com"
    body = message.get_body(preferencelist=("html",))
    assert body is not None
    assert body.get_content() == "<b>Hi</b>"


@pytest.mark.parametrize(
    ("reject_at", "error"),
    [
        ("starttls", smtplib.SMTPResponseException),
        ("auth", smtplib.SMTPAuthenticationError),
        ("mail", smtplib.SMTPSenderRefused),
        ("data", smtplib.SMTPDataError),
    ],
)
@pytest.mark.parametrize("fail_quit", [False, True])
def test_real_smtp_preserves_failure_and_cleanup(
    reject_at: str, error: type[smtplib.SMTPResponseException], fail_quit: bool, smtp_tls_context: ssl.SSLContext
) -> None:
    """A protocol rejection propagates without resend, even when cleanup disconnects."""
    with _SMTPRelay(smtp_tls_context, "starttls", reject_at=reject_at, fail_quit=fail_quit) as relay:
        with pytest.raises(error) as failure:
            _relay_client(relay, username="test-user", password="test-password").send(_mail())
    assert failure.value.smtp_code == {"starttls": 454, "auth": 535, "mail": 550, "data": 554}[reject_at]
    assert relay.commands.count("quit") == 1
    assert sum(line.startswith("mail ") for line in relay.commands) <= 1
    assert not relay.messages


def test_real_smtp_accepted_message_survives_cleanup_disconnect(smtp_tls_context: ssl.SSLContext) -> None:
    """A failed QUIT must not turn an accepted message into a retryable send failure."""
    with _SMTPRelay(smtp_tls_context, "starttls", fail_quit=True) as relay:
        assert _relay_client(relay).send(_mail()) is None
    assert len(relay.messages) == 1


@pytest.mark.parametrize(
    ("username", "password", "auth_count"),
    [("test-user", "test-password", 1), ("", "test-password", 0), ("test-user", "", 0), (" ", " ", 0)],
)
def test_real_smtp_authentication_selection(
    username: str, password: str, auth_count: int, smtp_tls_context: ssl.SSLContext
) -> None:
    """Keep authentication opt-in to two nonblank credentials; send exactly once."""
    with _SMTPRelay(smtp_tls_context, "plain") as relay:
        _relay_client(relay, username=username, password=password).send(_mail())
    assert sum(line.startswith("AUTH ") for line in relay.commands) == auth_count
    assert len(relay.messages) == 1
