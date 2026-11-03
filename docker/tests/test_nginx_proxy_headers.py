"""Exercise the Docker Nginx proxy templates against a real Nginx process."""

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.serving import make_server
from werkzeug.wrappers import Request, Response

DOCKER_DIR = Path(__file__).resolve().parents[1]
NGINX_DIR = DOCKER_DIR / "nginx"


def _echo_request(environ: dict[str, Any], start_response: Any) -> list[bytes]:
    request = Request(environ)
    payload = {
        "forwarded_port": request.headers.get("X-Forwarded-Port"),
        "host": request.host,
        "url_root": request.url_root,
    }
    return Response(json.dumps(payload), content_type="application/json")(
        environ, start_response
    )


_proxy_fixed_echo = ProxyFix(_echo_request, x_for=1, x_port=1)


def _test_application(environ: dict[str, Any], start_response: Any) -> list[bytes]:
    if environ["PATH_INFO"] == "/proxy-fix":
        return _proxy_fixed_echo(environ, start_response)
    return _echo_request(environ, start_response)


def _render_template(source: Path, replacements: dict[str, str]) -> str:
    rendered = source.read_text(encoding="utf-8")
    for name, value in replacements.items():
        rendered = rendered.replace(f"${{{name}}}", value)
    return rendered


@unittest.skipUnless(
    sys.platform.startswith("linux"), "Docker host networking is required"
)
class NginxProxyHeaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._temporary_directory = tempfile.TemporaryDirectory(
            prefix="dify-nginx-proxy-test-"
        )
        cls.addClassCleanup(cls._temporary_directory.cleanup)
        cls._config_directory = Path(cls._temporary_directory.name)

        cls._backend = make_server("127.0.0.1", 0, _test_application)
        cls.addClassCleanup(cls._backend.server_close)
        cls.addClassCleanup(cls._backend.shutdown)
        cls._backend_thread = threading.Thread(
            target=cls._backend.serve_forever, daemon=True
        )
        cls._backend_thread.start()

        cls._nginx_port = cls._unused_local_port()
        cls._container_name = f"dify-nginx-proxy-test-{uuid.uuid4().hex[:12]}"
        cls.addClassCleanup(cls._remove_container)
        cls._write_nginx_config()
        cls._start_nginx()
        cls._wait_until_ready()

    @classmethod
    def _unused_local_port(cls) -> int:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            return listener.getsockname()[1]

    @classmethod
    def _write_nginx_config(cls) -> None:
        nginx_config = _render_template(
            NGINX_DIR / "nginx.conf.template",
            {
                "NGINX_CLIENT_MAX_BODY_SIZE": "1m",
                "NGINX_KEEPALIVE_TIMEOUT": "5",
                "NGINX_WORKER_PROCESSES": "1",
            },
        )
        proxy_config = _render_template(
            NGINX_DIR / "proxy.conf.template",
            {
                "NGINX_PROXY_READ_TIMEOUT": "5s",
                "NGINX_PROXY_SEND_TIMEOUT": "5s",
            },
        )
        server_config = f"""
server {{
    listen 127.0.0.1:{cls._nginx_port};
    server_name fallback.test;

    location / {{
        proxy_pass http://127.0.0.1:{cls._backend.server_port};
        include /etc/nginx/proxy.conf;
    }}
}}
"""
        (cls._config_directory / "nginx.conf").write_text(
            nginx_config, encoding="utf-8"
        )
        (cls._config_directory / "proxy.conf").write_text(
            proxy_config, encoding="utf-8"
        )
        (cls._config_directory / "default.conf").write_text(
            server_config, encoding="utf-8"
        )

    @classmethod
    def _start_nginx(cls) -> None:
        image = os.environ.get("NGINX_TEST_IMAGE", "nginx:latest")
        command = [
            "docker",
            "run",
            "--detach",
            "--name",
            cls._container_name,
            "--network",
            "host",
            "--volume",
            f"{cls._config_directory / 'nginx.conf'}:/etc/nginx/nginx.conf:ro",
            "--volume",
            f"{cls._config_directory / 'proxy.conf'}:/etc/nginx/proxy.conf:ro",
            "--volume",
            f"{cls._config_directory / 'default.conf'}:/etc/nginx/conf.d/default.conf:ro",
            "--entrypoint",
            "nginx",
            image,
            "-g",
            "daemon off;",
        ]
        subprocess.run(command, check=True, capture_output=True, text=True, timeout=120)

    @classmethod
    def _remove_container(cls) -> None:
        try:
            subprocess.run(
                ["docker", "rm", "--force", cls._container_name],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            pass

    @classmethod
    def _wait_until_ready(cls) -> None:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                cls._request("/raw", "ready.test")
                return
            except (OSError, urllib.error.URLError):
                time.sleep(0.1)

        logs = subprocess.run(
            ["docker", "logs", cls._container_name],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        raise RuntimeError(f"Nginx did not become ready:\n{logs.stdout}\n{logs.stderr}")

    @classmethod
    def _request(
        cls, path: str, host: str, forwarded_port: str | None = None
    ) -> dict[str, Any]:
        request = urllib.request.Request(f"http://127.0.0.1:{cls._nginx_port}{path}")
        request.add_header("Host", host)
        if forwarded_port is not None:
            request.add_header("X-Forwarded-Port", forwarded_port)
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    @classmethod
    def _request_without_host(cls, path: str) -> dict[str, Any]:
        with socket.create_connection(
            ("127.0.0.1", cls._nginx_port), timeout=5
        ) as client:
            client.sendall(f"GET {path} HTTP/1.0\r\n\r\n".encode())
            response = bytearray()
            while chunk := client.recv(4096):
                response.extend(chunk)
        _, body = bytes(response).split(b"\r\n\r\n", 1)
        return json.loads(body)

    def assert_authority(self, host: str, expected_url_root: str) -> None:
        for path in ("/raw", "/proxy-fix"):
            with self.subTest(path=path, host=host):
                response = self._request(path, host, forwarded_port="9999")
                self.assertEqual(response["host"], host)
                self.assertEqual(response["url_root"], expected_url_root)

    def test_explicit_external_port_replaces_untrusted_forwarded_port(self) -> None:
        self.assert_authority("localhost:8081", "http://localhost:8081/")
        response = self._request("/raw", "localhost:8081", forwarded_port="9999")
        self.assertEqual(response["forwarded_port"], "8081")

    def test_bracketed_ipv6_authority_preserves_explicit_port(self) -> None:
        self.assert_authority("[2001:db8::1]:8081", "http://[2001:db8::1]:8081/")
        response = self._request("/raw", "[2001:db8::1]:8081")
        self.assertEqual(response["forwarded_port"], "8081")

    def test_explicit_standard_http_port_is_preserved_for_proxy_fix(self) -> None:
        for path in ("/raw", "/proxy-fix"):
            with self.subTest(path=path):
                response = self._request(path, "example.test:80", forwarded_port="9999")
                self.assertEqual(response["forwarded_port"], "80")
                self.assertEqual(response["host"], "example.test")
                self.assertEqual(response["url_root"], "http://example.test/")

    def test_authority_without_port_removes_untrusted_forwarded_port(self) -> None:
        for host, expected_url_root in (
            ("example.test", "http://example.test/"),
            ("[2001:db8::1]", "http://[2001:db8::1]/"),
        ):
            self.assert_authority(host, expected_url_root)
            response = self._request("/raw", host, forwarded_port="9999")
            self.assertIsNone(response["forwarded_port"])

    def test_http_1_0_request_without_host_uses_nginx_fallback(self) -> None:
        raw = self._request_without_host("/raw")
        self.assertEqual(raw["forwarded_port"], str(self._nginx_port))
        self.assertEqual(raw["host"], "fallback.test")
        self.assertEqual(raw["url_root"], "http://fallback.test/")

        proxy_fixed = self._request_without_host("/proxy-fix")
        self.assertEqual(proxy_fixed["forwarded_port"], str(self._nginx_port))
        self.assertEqual(proxy_fixed["host"], f"fallback.test:{self._nginx_port}")
        self.assertEqual(
            proxy_fixed["url_root"], f"http://fallback.test:{self._nginx_port}/"
        )


if __name__ == "__main__":
    unittest.main()
