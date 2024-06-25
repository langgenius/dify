from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from models.workflow import EnvironmentVariable


def encrypt_environment_variable(var: "EnvironmentVariable", *, encrypt_func) -> "EnvironmentVariable":
    var.value = encrypt_func(var.value)
    return var