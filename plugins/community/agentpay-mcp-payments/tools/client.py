import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class AgentPayMCPError(RuntimeError):
    """Base error for AgentPay MCP plugin client."""


class AgentPayAuthError(AgentPayMCPError):
    """Raised when credentials are invalid."""


class AgentPayTimeoutError(AgentPayMCPError):
    """Raised when request exceeds timeout."""


@dataclass(slots=True)
class AgentPayMCPClient:
    gateway_key: str
    gateway_url: str
    mcp_http_url: str | None
    launch_mode: str
    command: str
    timeout_seconds: int = 30

    @classmethod
    def from_credentials(cls, credentials: dict[str, Any]) -> "AgentPayMCPClient":
        gateway_key = str(credentials.get("agentpay_gateway_key") or "").strip()
        if not gateway_key:
            raise AgentPayAuthError("Missing AgentPay gateway key")

        gateway_url = str(credentials.get("agentpay_url") or "https://agentpay.metaltorque.dev").strip()
        mcp_http_url = str(credentials.get("agentpay_mcp_http_url") or "").strip() or None
        launch_mode = str(credentials.get("agentpay_launch_mode") or "auto").strip().lower()
        command = str(credentials.get("agentpay_command") or "npx").strip()

        return cls(
            gateway_key=gateway_key,
            gateway_url=gateway_url,
            mcp_http_url=mcp_http_url,
            launch_mode=launch_mode,
            command=command,
        )

    def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if self.launch_mode == "http":
            return self._http_call(tool_name, arguments)

        if self.launch_mode == "stdio":
            return self._stdio_call(tool_name, arguments)

        # auto mode: prefer HTTP, fallback to stdio.
        try:
            return self._http_call(tool_name, arguments)
        except AgentPayAuthError:
            raise
        except Exception:
            return self._stdio_call(tool_name, arguments)

    def _http_call(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        print(f"[AgentPayMCPClient] HTTP call to {self.mcp_http_url} with tool '{tool_name}' and arguments {arguments}")
        if not self.mcp_http_url:
            raise AgentPayMCPError("MCP HTTP URL is not configured")

        payload = {
            "jsonrpc": "2.0",
            "id": "dify-agentpay-1",
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }

        request = urllib.request.Request(
            self.mcp_http_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.gateway_key}",
                "X-AgentPay-Gateway-Key": self.gateway_key,
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise AgentPayAuthError("AgentPay authorization failed") from exc
            raise AgentPayMCPError(f"AgentPay HTTP call failed: {exc}") from exc
        except TimeoutError as exc:
            raise AgentPayTimeoutError("AgentPay HTTP call timed out") from exc
        except Exception as exc:  # noqa: BLE001
            raise AgentPayMCPError(f"AgentPay HTTP call failed: {exc}") from exc

        try:
            parsed = json.loads(body)
        except json.JSONDecodeError as exc:
            raise AgentPayMCPError("AgentPay HTTP response is not valid JSON") from exc

        return self._normalize_mcp_result(parsed)

    def _stdio_call(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        env = dict(os.environ)
        env["AGENTPAY_GATEWAY_KEY"] = self.gateway_key
        env.setdefault("AGENTPAY_URL", self.gateway_url)

        args = [self.command, "-y", "mcp-server-agentpay"]
        process = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )

        try:
            initialize_request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "dify-agentpay-plugin",
                        "version": "0.0.1",
                    },
                },
            }
            initialized_notification = {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {},
            }
            tool_call_request = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments,
                },
            }

            self._write_message(process, initialize_request)
            _ = self._read_message(process)
            self._write_message(process, initialized_notification)
            self._write_message(process, tool_call_request)
            response = self._read_message(process)

            return self._normalize_mcp_result(response)
        except TimeoutError as exc:
            raise AgentPayTimeoutError("AgentPay stdio call timed out") from exc
        except Exception as exc:  # noqa: BLE001
            raise AgentPayMCPError(f"AgentPay stdio call failed: {exc}") from exc
        finally:
            process.kill()

    def _write_message(self, process: subprocess.Popen[bytes], payload: dict[str, Any]) -> None:
        if process.stdin is None:
            raise AgentPayMCPError("stdio input is unavailable")
        data = json.dumps(payload).encode("utf-8")
        header = f"Content-Length: {len(data)}\r\n\r\n".encode("utf-8")
        process.stdin.write(header + data)
        process.stdin.flush()

    def _read_message(self, process: subprocess.Popen[bytes]) -> dict[str, Any]:
        if process.stdout is None:
            raise AgentPayMCPError("stdio output is unavailable")

        deadline = time.time() + self.timeout_seconds

        def read_line() -> bytes:
            while time.time() < deadline:
                line = process.stdout.readline()
                if line:
                    return line
            raise TimeoutError("Timed out reading MCP headers")

        content_length = 0
        while True:
            line = read_line()
            if line in (b"\r\n", b"\n", b""):
                break
            lower = line.decode("utf-8").lower()
            if lower.startswith("content-length:"):
                content_length = int(lower.split(":", 1)[1].strip())

        if content_length <= 0:
            raise AgentPayMCPError("Invalid MCP content length")

        remaining = content_length
        chunks: list[bytes] = []
        while remaining > 0:
            if time.time() >= deadline:
                raise TimeoutError("Timed out reading MCP payload")
            chunk = process.stdout.read(remaining)
            if not chunk:
                raise AgentPayMCPError("MCP server closed output early")
            chunks.append(chunk)
            remaining -= len(chunk)

        data = b"".join(chunks)
        return json.loads(data.decode("utf-8"))

    def _normalize_mcp_result(self, response: dict[str, Any]) -> dict[str, Any]:
        if "error" in response:
            message = response["error"].get("message", "Unknown MCP error")
            if "auth" in message.lower() or "key" in message.lower():
                raise AgentPayAuthError(message)
            raise AgentPayMCPError(message)

        result = response.get("result")
        if not isinstance(result, dict):
            raise AgentPayMCPError("Invalid MCP result payload")

        content = result.get("content")
        if isinstance(content, list):
            for item in content:
                if item.get("type") == "text" and "text" in item:
                    text = item["text"]
                    try:
                        parsed_text = json.loads(text)
                        if isinstance(parsed_text, dict):
                            return parsed_text
                    except json.JSONDecodeError:
                        return {"text": text}
                if item.get("type") == "json" and isinstance(item.get("json"), dict):
                    return item["json"]

        return result
