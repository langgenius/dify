#!/usr/bin/env python3
"""Smoke-test a built Web image without publishing ports or starting the API."""

import argparse
import concurrent.futures
import hashlib
import http.client
import json
import socket
import struct
import subprocess
import sys
import time
import uuid
from pathlib import Path


def listeners():
    """Read Linux inet_diag's LISTEN idiag_wqueue (sk_max_ack_backlog)."""
    for family in (socket.AF_INET, socket.AF_INET6):
        # inet_diag_req_v2 + inet_diag_sockid, requesting TCP_LISTEN sockets.
        request = struct.pack("=BBBBI", family, socket.IPPROTO_TCP, 0, 0, 1 << 10)
        request += bytes(40) + bytes([255]) * 8
        header = struct.pack("=IHHII", 16 + len(request), 20, 0x301, 1, 0)
        with socket.socket(socket.AF_NETLINK, socket.SOCK_RAW, 4) as diag:
            diag.settimeout(5)
            diag.sendto(header + request, (0, 0))
            done = False
            while not done:
                data = diag.recv(65536)
                offset = 0
                while offset < len(data):
                    size, kind = struct.unpack_from("=IH", data, offset)
                    if size < 16 or offset + size > len(data):
                        raise RuntimeError("Invalid inet_diag response")
                    body = data[offset + 16 : offset + size]
                    if kind == 3:  # NLMSG_DONE
                        done = True
                    elif kind == 2:  # NLMSG_ERROR
                        raise RuntimeError(f"inet_diag error: {body.hex()}")
                    elif (
                        len(body) >= 72 and struct.unpack_from("!H", body, 4)[0] == 3000
                    ):
                        address = socket.inet_ntop(
                            family, body[8 : 12 if family == socket.AF_INET else 24]
                        )
                        yield address, struct.unpack_from("=I", body, 60)[0]
                    offset += (size + 3) & ~3


def probe(expected_hash, expected_address):
    deadline = time.monotonic() + 60
    last_error = "No listener on port 3000"
    while time.monotonic() < deadline:
        for address, backlog in listeners():
            host = {"0.0.0.0": "127.0.0.1", "::": "::1"}.get(address, address)

            def fetch():
                connection = http.client.HTTPConnection(host, 3000, timeout=5)
                try:
                    connection.request("GET", "/favicon.ico")
                    response = connection.getresponse()
                    digest = hashlib.sha256(response.read()).hexdigest()
                    if response.status != 200 or digest != expected_hash:
                        raise RuntimeError(
                            f"Unexpected favicon: HTTP {response.status}, "
                            f"SHA256 {digest}"
                        )
                finally:
                    connection.close()

            try:
                fetch()
            except (OSError, http.client.HTTPException) as error:
                last_error = str(error)
                continue
            if backlog == 0:
                raise RuntimeError(f"Zero listen backlog at {address}:3000")
            if expected_address and address != expected_address:
                raise RuntimeError(f"Expected bind {expected_address}, got {address}")
            with concurrent.futures.ThreadPoolExecutor(max_workers=40) as pool:
                list(pool.map(lambda _: fetch(), range(40)))
            print(
                json.dumps(
                    {"address": address, "backlog": backlog, "concurrentAssets": 40}
                )
            )
            return
        time.sleep(0.5)
    raise RuntimeError(f"Web image did not become ready: {last_error}")


def docker(*args, **kwargs):
    return subprocess.run(
        ["docker", *args],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
        **kwargs,
    )


def smoke(image, probe_image):
    docker("image", "inspect", image)
    docker("image", "inspect", probe_image)
    digest = hashlib.sha256(
        (Path(__file__).resolve().parents[1] / "public/favicon.ico").read_bytes()
    ).hexdigest()
    cases = [
        ("next-normal", "a1b2c3d4e5f6", [], "0.0.0.0"),
        ("next-numeric", "30889528e495", [], "0.0.0.0"),
        ("next-override", "30889528e495", ["-e", "HOSTNAME=127.0.0.1"], "127.0.0.1"),
        (
            "vinext-numeric",
            "30889528e495",
            ["-e", "EXPERIMENTAL_ENABLE_VINEXT=true"],
            "",
        ),
    ]
    failed = False
    for name, hostname, environment, address in cases:
        prefix = f"dify-hostname-{uuid.uuid4().hex[:12]}"
        web, helper = prefix + "-web", prefix + "-probe"
        try:
            docker(
                "run",
                "--detach",
                "--pull=never",
                "--name",
                web,
                "--hostname",
                hostname,
                "--cpus=1",
                "--memory=1g",
                *environment,
                image,
            )
            result = docker(
                "run",
                "--rm",
                "--interactive",
                "--pull=never",
                "--name",
                helper,
                "--network",
                f"container:{web}",
                "--cpus=1",
                "--memory=256m",
                probe_image,
                "python",
                "-",
                "--probe",
                digest,
                "--address",
                address,
                input=Path(__file__).read_text(encoding="utf-8"),
            )
            print(f"PASS {name}: {result.stdout.strip()}", flush=True)
        except (subprocess.SubprocessError, OSError) as error:
            failed = True
            print(f"FAIL {name}: {error}", file=sys.stderr, flush=True)
            if isinstance(error, subprocess.CalledProcessError):
                print(error.stderr, file=sys.stderr)
            logs = subprocess.run(
                ["docker", "logs", "--tail", "30", web],
                capture_output=True,
                text=True,
                timeout=15,
            )
            print(logs.stdout + logs.stderr, file=sys.stderr)
        finally:
            # Only remove the two unique names allocated by this test case.
            subprocess.run(
                ["docker", "rm", "--force", helper, web],
                capture_output=True,
                timeout=30,
            )
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", help="Locally built production Web image")
    parser.add_argument("--probe-image", default="python:3.13-slim")
    parser.add_argument("--probe", help=argparse.SUPPRESS)
    parser.add_argument("--address", default="", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.probe:
        probe(args.probe, args.address)
    else:
        if not args.image:
            parser.error("--image is required")
        sys.exit(smoke(args.image, args.probe_image))
