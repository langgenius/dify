from collections.abc import Mapping
from functools import lru_cache
from typing import Any

from docker.models.containers import Container

import docker
from core.virtual_environment.__base.entities import Arch, Metadata
from core.virtual_environment.__base.exec import ArchNotSupportedError, VirtualEnvironmentLaunchFailedError
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


class DockerDaemonEnvironment(VirtualEnvironment):
    def construct_environment(self, options: Mapping[str, Any]) -> Metadata:
        """
        Construct the Docker daemon virtual environment.
        """

        docker_sock = options.get("docker_sock", "unix:///var/run/docker.sock")
        docker_client = self.get_docker_daemon(docker_sock)

        # TODO: use a better image in practice
        default_docker_image = options.get("docker_agent_image", "ubuntu:latest")

        container = docker_client.containers.run(image=default_docker_image, detach=True, remove=True)

        # wait for the container to be fully started
        container.reload()

        if not container.id:
            raise VirtualEnvironmentLaunchFailedError("Failed to start Docker container for DockerDaemonEnvironment.")

        return Metadata(
            id=container.id,
            arch=self._get_container_architecture(container),
        )

    @lru_cache(maxsize=5)
    @classmethod
    def get_docker_daemon(cls, docker_sock: str) -> docker.DockerClient:
        """
        Get the Docker daemon client.

        NOTE: I guess nobody will use more than 5 different docker sockets in practice....
        """
        return docker.DockerClient(base_url=docker_sock)

    def _get_container_architecture(self, container: Container) -> Arch:
        """
        Get the architecture of the Docker container.
        """
        container.reload()
        arch_str: str = container.attrs["Architecture"]
        match arch_str.lower():
            case "x86_64" | "amd64":
                return Arch.AMD64
            case "aarch64" | "arm64":
                return Arch.ARM64
            case _:
                raise ArchNotSupportedError(f"Architecture {arch_str} is not supported in DockerDaemonEnvironment.")
