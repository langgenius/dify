from enum import StrEnum

from configs import dify_config


class SandboxType(StrEnum):
    DOCKER = "docker"
    E2B = "e2b"
    LOCAL = "local"
    SSH = "ssh"
    AWS_CODE_INTERPRETER = "aws_code_interpreter"

    @classmethod
    def get_all(cls) -> list[str]:
        if dify_config.EDITION == "SELF_HOSTED":
            return [p.value for p in cls]
        else:
            return [p.value for p in cls if p != SandboxType.LOCAL]
