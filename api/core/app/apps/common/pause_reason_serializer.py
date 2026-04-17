from collections.abc import Mapping
from typing import Any

from graphon.entities.pause_reason import PauseReason


def pause_reason_to_public_dict(reason: PauseReason | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(reason, Mapping):
        data = dict(reason)
    else:
        data = dict(reason.model_dump(mode="json"))

    discriminator = data.pop("TYPE", None)
    if discriminator is not None:
        data["type"] = discriminator

    return data
