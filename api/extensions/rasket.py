"""Rasket mail adapter; each send makes one SSRF-protected HTTP request."""

from core.helper import ssrf_proxy


class RasketClient:
    def __init__(self, api_key: str):
        """Store the configured API key without performing network I/O."""
        self._api_key = api_key

    def send(self, mail: dict[str, str]) -> None:
        """Submit a validated Mail.send payload without mutating it.

        Requires nonempty from, to, subject and html fields. Returns after HTTP
        acceptance; HTTP and transport errors propagate to the caller. Requests
        are not retried because an ambiguous failure may already have sent mail.
        """
        response = ssrf_proxy.post(
            "https://api.rasket.com/emails",
            headers={"Authorization": f"Bearer {self._api_key}", "User-Agent": "Dify"},
            json={
                "from": mail["from"],
                "to": [mail["to"]],
                "subject": mail["subject"],
                "html": mail["html"],
            },
            max_retries=0,
            timeout=10,
        )
        response.raise_for_status()
