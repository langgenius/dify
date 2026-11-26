"""Synthetic loopback-only CI target; never contacts another service."""

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Canary(BaseHTTPRequestHandler):
    calls = 0
    lock = threading.Lock()

    def do_GET(self):
        if self.path == "/canary":
            with self.lock:
                type(self).calls += 1
            payload = b"native-broker-canary"
        elif self.path == "/count":
            with self.lock:
                payload = str(type(self).calls).encode("ascii")
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format, *_args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 18081), Canary).serve_forever()
