from dataclasses import dataclass
from typing import cast

import pytest
from obs import ObsClient

from extensions.storage.huawei_obs_storage import HuaweiObsStorage


@dataclass(frozen=True)
class _ObsResponse:
    status: int
    errorCode: str


class _HuaweiClient:
    def __init__(self, response: _ObsResponse) -> None:
        self.response = response
        self.deleted: list[tuple[str, str]] = []

    def deleteObject(self, *, bucketName: str, objectKey: str) -> _ObsResponse:  # noqa: N802, N803
        self.deleted.append((bucketName, objectKey))
        return self.response


def _make_storage(client: _HuaweiClient) -> HuaweiObsStorage:
    storage = object.__new__(HuaweiObsStorage)
    storage.bucket_name = "test-bucket"
    storage.client = cast(ObsClient, client)
    return storage


def test_delete_succeeds_when_object_is_absent() -> None:
    client = _HuaweiClient(_ObsResponse(status=404, errorCode="NoSuchKey"))

    _make_storage(client).delete("missing.txt")

    assert client.deleted == [("test-bucket", "missing.txt")]


@pytest.mark.parametrize(
    ("status", "code"),
    [(403, "AccessDenied"), (503, "ServiceUnavailable")],
)
def test_delete_propagates_non_missing_storage_failures(status: int, code: str) -> None:
    client = _HuaweiClient(_ObsResponse(status=status, errorCode=code))

    with pytest.raises(RuntimeError, match=rf"status={status}, code={code}"):
        _make_storage(client).delete("retry.txt")

    assert client.deleted == [("test-bucket", "retry.txt")]
