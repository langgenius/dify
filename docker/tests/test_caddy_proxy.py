"""Check how the optional Caddy proxy reads the shared NGINX_* settings."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

DOCKER_DIR = Path(__file__).resolve().parents[1]
CADDY_DIR = DOCKER_DIR / "caddy"
CADDY_IMAGE = "caddy:2.11-alpine"


def run_translation(**settings: str) -> subprocess.CompletedProcess[str]:
    env = {"PATH": os.environ["PATH"], **settings}
    return subprocess.run(
        ["sh", "-c", '. "$1" && dify_proxy_env && env', "sh", str(CADDY_DIR / "proxy-env.sh")],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def translate(**settings: str) -> dict[str, str]:
    """Run proxy-env.sh with only the given settings and return the exported DIFY_PROXY_* values."""
    result = run_translation(**settings)
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if line.startswith("DIFY_PROXY_"))


def docker_available() -> bool:
    try:
        return subprocess.run(["docker", "info"], capture_output=True, check=False).returncode == 0
    except FileNotFoundError:
        return False


class ProxySettingsTests(unittest.TestCase):
    def test_defaults_match_nginx_defaults(self):
        values = translate()
        self.assertEqual(values["DIFY_PROXY_MAX_BODY_SIZE"], "100MiB")
        self.assertEqual(values["DIFY_PROXY_READ_TIMEOUT"], "3600s")
        self.assertEqual(values["DIFY_PROXY_SEND_TIMEOUT"], "3600s")
        self.assertEqual(values["DIFY_PROXY_IDLE_TIMEOUT"], "65s")
        self.assertEqual(values["DIFY_PROXY_TLS_PROTOCOLS"], "tls1.2 tls1.3")
        self.assertEqual(values["DIFY_PROXY_SOCKET_IO_UPSTREAM"], "api_websocket:5001")
        self.assertEqual(values["DIFY_PROXY_HTTPS"], "off")
        self.assertEqual(values["DIFY_PROXY_ACME_CHALLENGE"], "off")
        self.assertEqual(values["DIFY_PROXY_CLIENT_IP"], "direct")

    def test_sizes_keep_nginx_binary_units(self):
        for nginx_value, caddy_value in {
            "100M": "100MiB",
            "512k": "512KiB",
            "2G": "2GiB",
            "1048576": "1048576",
        }.items():
            with self.subTest(nginx_value=nginx_value):
                values = translate(NGINX_CLIENT_MAX_BODY_SIZE=nginx_value)
                self.assertEqual(values["DIFY_PROXY_MAX_BODY_SIZE"], caddy_value)

    def test_bare_seconds_get_a_unit(self):
        values = translate(NGINX_PROXY_READ_TIMEOUT="600", NGINX_PROXY_SEND_TIMEOUT="1h", NGINX_KEEPALIVE_TIMEOUT="30s")
        self.assertEqual(values["DIFY_PROXY_READ_TIMEOUT"], "600s")
        self.assertEqual(values["DIFY_PROXY_SEND_TIMEOUT"], "1h")
        self.assertEqual(values["DIFY_PROXY_IDLE_TIMEOUT"], "30s")

    def test_tls_protocol_lists_become_a_range(self):
        for protocols, expected in {
            "TLSv1.3": "tls1.3 tls1.3",
            "TLSv1.2": "tls1.2 tls1.2",
            "TLSv1.3 TLSv1.2": "tls1.2 tls1.3",
            "TLSv1 TLSv1.1 TLSv1.2 TLSv1.3": "tls1.2 tls1.3",
        }.items():
            with self.subTest(protocols=protocols):
                self.assertEqual(translate(NGINX_SSL_PROTOCOLS=protocols)["DIFY_PROXY_TLS_PROTOCOLS"], expected)

    def test_https_uses_certbot_certificate_when_present(self):
        with tempfile.TemporaryDirectory() as temp:
            live = Path(temp) / "live"
            ssl = Path(temp) / "ssl"
            settings = {
                "NGINX_HTTPS_ENABLED": "true",
                "NGINX_SSL_CERT_FILENAME": "fullchain.pem",
                "NGINX_SSL_CERT_KEY_FILENAME": "privkey.pem",
                "CERTBOT_DOMAIN": "dify.example.com",
                "DIFY_PROXY_CERTBOT_LIVE_DIR": str(live),
                "DIFY_PROXY_SSL_DIR": str(ssl),
            }
            values = translate(**settings)
            self.assertEqual(values["DIFY_PROXY_HTTPS"], "files")
            self.assertEqual(values["DIFY_PROXY_TLS_CERT"], f"{ssl}/fullchain.pem")

            domain = live / "dify.example.com"
            domain.mkdir(parents=True)
            (domain / "fullchain.pem").write_text("cert")
            (domain / "privkey.pem").write_text("key")
            values = translate(**settings)
            self.assertEqual(values["DIFY_PROXY_TLS_CERT"], f"{domain}/fullchain.pem")
            self.assertEqual(values["DIFY_PROXY_TLS_KEY"], f"{domain}/privkey.pem")

    def test_certbot_challenge_follows_nginx_flag(self):
        self.assertEqual(translate(NGINX_ENABLE_CERTBOT_CHALLENGE="true")["DIFY_PROXY_ACME_CHALLENGE"], "on")
        self.assertEqual(translate(NGINX_ENABLE_CERTBOT_CHALLENGE="false")["DIFY_PROXY_ACME_CHALLENGE"], "off")

    def test_trusted_proxies_enable_client_ip_resolution(self):
        values = translate(
            CADDY_TRUSTED_PROXIES="192.0.2.10/32,198.51.100.0/24", CADDY_CLIENT_IP_HEADERS="CF-Connecting-IP"
        )
        self.assertEqual(values["DIFY_PROXY_CLIENT_IP"], "trusted")
        self.assertEqual(values["DIFY_PROXY_TRUSTED_PROXIES"], "192.0.2.10/32 198.51.100.0/24")
        self.assertEqual(values["DIFY_PROXY_CLIENT_IP_HEADERS"], "CF-Connecting-IP")

    def test_trusting_every_address_is_refused(self):
        for value in ("0.0.0.0/0", "10.0.0.0/8 ::/0"):
            with self.subTest(value=value):
                result = run_translation(CADDY_TRUSTED_PROXIES=value)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("must not contain", result.stderr)

    def test_auto_https_domains_switch_to_acme(self):
        values = translate(CADDY_AUTO_HTTPS_DOMAINS="dify.example.com,www.dify.example.com")
        self.assertEqual(values["DIFY_PROXY_HTTPS"], "acme")
        self.assertEqual(values["DIFY_PROXY_AUTO_HTTPS"], "disable_redirects")
        self.assertEqual(values["DIFY_PROXY_ACME_SITES"], "dify.example.com, www.dify.example.com")
        self.assertEqual(values["DIFY_PROXY_ACME_CA"], "https://acme-v02.api.letsencrypt.org/directory")
        staging = "https://acme-staging-v02.api.letsencrypt.org/directory"
        values = translate(CADDY_AUTO_HTTPS_DOMAINS="dify.example.com", CADDY_ACME_CA=staging)
        self.assertEqual(values["DIFY_PROXY_ACME_CA"], staging)
        self.assertEqual(translate()["DIFY_PROXY_AUTO_HTTPS"], "off")

    def test_auto_https_and_certificate_files_are_exclusive(self):
        result = run_translation(CADDY_AUTO_HTTPS_DOMAINS="dify.example.com", NGINX_HTTPS_ENABLED="true")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not both", result.stderr)


@unittest.skipUnless(docker_available(), "needs a Docker daemon to run Caddy")
class CaddyfileTests(unittest.TestCase):
    def adapt(self, **settings: str) -> dict:
        env_args = [arg for key, value in settings.items() for arg in ("-e", f"{key}={value}")]
        result = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{CADDY_DIR}:/etc/caddy:ro",
                "-e",
                "NGINX_PORT=80",
                "-e",
                "NGINX_SSL_PORT=443",
                *env_args,
                CADDY_IMAGE,
                "sh",
                "-c",
                ". /etc/caddy/proxy-env.sh && dify_proxy_env && caddy adapt --config /etc/caddy/Caddyfile",
            ],
            text=True,
            capture_output=True,
            check=True,
        )
        return json.loads(result.stdout)

    def test_http_only_by_default(self):
        servers = self.adapt()["apps"]["http"]["servers"]
        self.assertEqual([server["listen"] for server in servers.values()], [[":80"]])
        config = json.dumps(servers)
        self.assertIn('"max_size": 104857600', config)
        self.assertNotIn("acme-challenge", config)

    def test_https_and_certbot_challenge(self):
        config = self.adapt(NGINX_HTTPS_ENABLED="true", NGINX_ENABLE_CERTBOT_CHALLENGE="true")
        listens = sorted(server["listen"][0] for server in config["apps"]["http"]["servers"].values())
        self.assertEqual(listens, [":443", ":80"])
        loaded = config["apps"]["tls"]["certificates"]["load_files"][0]
        self.assertEqual(loaded["certificate"], "/etc/ssl/dify.crt")
        self.assertEqual(loaded["key"], "/etc/ssl/dify.key")
        self.assertIn("/.well-known/acme-challenge/*", json.dumps(config))

    def test_auto_https_serves_the_domains_on_the_tls_port(self):
        config = self.adapt(CADDY_AUTO_HTTPS_DOMAINS="dify.example.com www.dify.example.com")
        http = config["apps"]["http"]
        self.assertEqual((http["http_port"], http["https_port"]), (80, 443))
        servers = {server["listen"][0]: server for server in http["servers"].values()}
        self.assertEqual(sorted(servers), [":443", ":80"])
        self.assertEqual(servers[":443"]["routes"][0]["match"][0]["host"], ["dify.example.com", "www.dify.example.com"])
        for server in servers.values():
            # HTTP keeps serving Dify, as with Nginx.
            self.assertEqual(server["automatic_https"], {"disable_redirects": True})

    def test_trusted_proxies_reach_every_server(self):
        config = self.adapt(NGINX_HTTPS_ENABLED="true", CADDY_TRUSTED_PROXIES="192.0.2.10/32")
        for server in config["apps"]["http"]["servers"].values():
            self.assertEqual(server["trusted_proxies"], {"ranges": ["192.0.2.10/32"], "source": "static"})
            self.assertEqual(server["client_ip_headers"], ["X-Forwarded-For"])
            self.assertTrue(server["trusted_proxies_strict"])
        self.assertIn('"X-Forwarded-For": ["{http.vars.client_ip}"]', json.dumps(config))


if __name__ == "__main__":
    unittest.main()
