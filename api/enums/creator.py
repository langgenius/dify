"""Creator identities shared by uploaded files, documents, and workflow runs."""

from enum import StrEnum
from typing import override


class CreatorUserRole(StrEnum):
    ACCOUNT = "account"
    END_USER = "end_user"
    DATASET_API_KEY = "dataset_api_key"

    @classmethod
    @override
    def _missing_(cls, value):
        if value == "end-user":
            return cls.END_USER
        else:
            return super()._missing_(value)
