from __future__ import annotations

from typing import Literal, Union

from typing_extensions import TypedDict

__all__ = ["Hyperparameters"]


class Hyperparameters(TypedDict, total=False):
    batch_size: Union[Literal["auto"], int]

    learning_rate_multiplier: Union[Literal["auto"], float]

    n_epochs: Union[Literal["auto"], int]
