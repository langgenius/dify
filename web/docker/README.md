# Web image smoke test

Build the production image from the repository root, then test it with Python 3
and a Linux Docker daemon:

```sh
docker build -f web/Dockerfile -t dify-web:local .
docker pull python:3.13-slim
python web/docker/test_hostname.py --image dify-web:local
```

The test starts the real image entrypoint with ordinary and scientific-notation
container hostnames, an explicit `HOSTNAME` override, and Vinext enabled. It reads
the Linux TCP listener's maximum backlog through `inet_diag` and requires a
nonzero queue, then checks 40 concurrent `/favicon.ico` requests against the
source asset's SHA256. This catches #45079 deterministically even when a small
HTTP burst happens to succeed with a zero backlog.

The official Python helper shares only the test container's network namespace.
No host ports, API service, credentials, privileged containers, or extra Python
packages are required. CPU and memory are limited; uniquely named test
containers are removed on completion. The Web Docker builds for both fork and
same-repository PRs run this test against their loaded Linux AMD64 image. Other
build architectures remain build checks only.
