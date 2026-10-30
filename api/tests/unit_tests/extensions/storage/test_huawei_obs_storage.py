from dataclasses import dataclass
from unittest.mock import create_autospec

import pytest
from obs import ObsClient

from extensions.storage.huawei_obs_storage import HuaweiObsStorage
from tests.helpers.unit.config_override import apply_config_overrides


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


def _make_storage(client: _HuaweiClient, monkeypatch: pytest.MonkeyPatch) -> HuaweiObsStorage:
    client_port = create_autospec(ObsClient, instance=True, spec_set=True)
    client_port.deleteObject.side_effect = client.deleteObject
    apply_config_overrides(
        monkeypatch,
        HUAWEI_OBS_BUCKET_NAME="test-bucket",
        HUAWEI_OBS_ACCESS_KEY="access-key",
        HUAWEI_OBS_SECRET_KEY="secret-key",
        HUAWEI_OBS_SERVER="https://obs.example.com",
        HUAWEI_OBS_PATH_STYLE=False,
    )
    monkeypatch.setattr("extensions.storage.huawei_obs_storage.ObsClient", lambda **_kwargs: client_port)
    return HuaweiObsStorage()


def test_delete_succeeds_when_object_is_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _HuaweiClient(_ObsResponse(status=404, errorCode="NoSuchKey"))

    _make_storage(client, monkeypatch).delete("missing.txt")

    assert client.deleted == [("test-bucket", "missing.txt")]


@pytest.mark.parametrize(
    ("status", "code"),
    [(403, "AccessDenied"), (503, "ServiceUnavailable")],
)
def test_delete_propagates_non_missing_storage_failures(
    status: int, code: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _HuaweiClient(_ObsResponse(status=status, errorCode=code))

    with pytest.raises(RuntimeError, match=rf"status={status}, code={code}"):
        _make_storage(client, monkeypatch).delete("retry.txt")

    assert client.deleted == [("test-bucket", "retry.txt")]
