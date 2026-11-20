"""SDK adapters distinguish missing objects from backend faults and enforce no-overwrite writes."""

from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from baidubce.exception import BceServerError
from botocore.exceptions import ClientError
from google.api_core.exceptions import Forbidden, NotFound, PreconditionFailed
from oss2.exceptions import NoSuchKey, ServerError
from qcloud_cos.cos_exception import CosServiceError
from storage3.exceptions import StorageApiError
from tos.exceptions import TosServerError

from extensions.storage.aliyun_oss_storage import AliyunOssStorage
from extensions.storage.aws_s3_storage import AwsS3Storage
from extensions.storage.baidu_obs_storage import BaiduObsStorage
from extensions.storage.base_storage import BaseStorage
from extensions.storage.google_cloud_storage import GoogleCloudStorage
from extensions.storage.huawei_obs_storage import HuaweiObsStorage
from extensions.storage.oracle_oci_storage import OracleOCIStorage
from extensions.storage.supabase_storage import SupabaseStorage
from extensions.storage.tencent_cos_storage import TencentCosStorage
from extensions.storage.volcengine_tos_storage import VolcengineTosStorage


@dataclass
class _Boundary:
    storage: BaseStorage
    read: MagicMock
    write: MagicMock
    missing: Exception
    failure: Exception
    existing: Exception | None  # None accompanies an unsupported atomic-create capability.
    condition: dict[str, object] | None  # None means this SDK has no admitted atomic-create capability.


@pytest.fixture(params=["s3", "oci", "oss", "bos", "cos", "tos", "supabase", "gcs"])
def boundary(request: pytest.FixtureRequest) -> _Boundary:
    client = MagicMock()
    storage: BaseStorage
    condition: dict[str, object] | None
    if request.param in ("s3", "oci"):
        concrete = object.__new__(AwsS3Storage if request.param == "s3" else OracleOCIStorage)
        concrete.bucket_name, concrete.client = "keys", client
        storage = concrete
        read, write = client.get_object, client.put_object
        missing = ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        failure = ClientError({"Error": {"Code": "AccessDenied"}}, "GetObject")
        existing = ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        condition = {"IfNoneMatch": "*"}
    elif request.param == "oss":
        oss = object.__new__(AliyunOssStorage)
        oss.bucket_name, oss.folder, oss.client = "keys", "prefix", client
        storage = oss
        read, write = client.get_object, client.put_object
        missing = NoSuchKey(404, {}, b"", {"Code": "NoSuchKey"})
        failure = ServerError(403, {}, b"", {"Code": "AccessDenied"})
        existing = ServerError(409, {}, b"", {"Code": "FileAlreadyExists"})
        condition = {"headers": {"x-oss-forbid-overwrite": "true"}}
    elif request.param == "bos":
        bos = object.__new__(BaiduObsStorage)
        bos.bucket_name, bos.client = "keys", client
        storage = bos
        read, write = client.get_object, client.put_object_from_string
        missing = BceServerError("Missing object", status_code=404, code="NoSuchKey")
        failure = BceServerError("Access denied", status_code=403, code="AccessDenied")
        existing = BceServerError("Existing object", status_code=409, code="ObjectAlreadyExists")
        condition = {"user_headers": {"x-bce-forbid-overwrite": "true"}}
    elif request.param == "cos":
        cos = object.__new__(TencentCosStorage)
        cos.bucket_name, cos.client = "keys", client
        storage = cos
        read, write = client.get_object, client.put_object
        missing = CosServiceError("GET", {"code": "NoSuchKey"}, 404)
        failure = CosServiceError("GET", {"code": "AccessDenied"}, 403)
        existing = None
        condition = None
    elif request.param == "tos":
        tos = object.__new__(VolcengineTosStorage)
        tos.bucket_name, tos.client = "keys", client
        storage = tos
        read, write = client.get_object, client.put_object
        response = SimpleNamespace(request_id="request", headers={}, status=404)
        missing = TosServerError(response, "Missing object", "NoSuchKey", "", "")
        failure = TosServerError(response, "Access denied", "AccessDenied", "", "")
        existing = TosServerError(response, "Existing object", "FileAlreadyExists", "", "")
        condition = {"forbid_overwrite": True}
    elif request.param == "supabase":
        supabase = object.__new__(SupabaseStorage)
        supabase.bucket_name, supabase.client = "keys", client
        storage = supabase
        bucket = client.storage.from_.return_value
        read, write = bucket.download, bucket.upload
        missing = StorageApiError("Missing object", "NoSuchKey", 404)
        failure = StorageApiError("Access denied", "AccessDenied", 403)
        existing = StorageApiError("Existing object", "Duplicate", 409)
        condition = {"file_options": {"upsert": "false"}}
    else:
        gcs = object.__new__(GoogleCloudStorage)
        gcs.bucket_name, gcs.client = "keys", client
        storage = gcs
        read = client.get_bucket.return_value.get_blob.return_value.download_as_bytes
        write = client.bucket.return_value.blob.return_value.upload_from_string
        missing, failure, existing = (
            NotFound("Missing object"),
            Forbidden("Access denied"),
            PreconditionFailed("Exists"),
        )
        condition = {"if_generation_match": 0}
    return _Boundary(storage, read, write, missing, failure, existing, condition)


def test_only_missing_objects_have_file_not_found_semantics(boundary: _Boundary) -> None:
    boundary.read.side_effect = boundary.missing
    with pytest.raises(FileNotFoundError):
        boundary.storage.load_once("private.pem")
    boundary.read.side_effect = boundary.failure
    with pytest.raises(OSError, match="read failed") as captured:
        boundary.storage.load_once("private.pem")
    assert not isinstance(captured.value, FileNotFoundError)
    boundary.write.assert_not_called()


def test_creation_requires_a_storage_side_no_overwrite_condition(boundary: _Boundary) -> None:
    if boundary.condition is None:
        with pytest.raises(NotImplementedError, match="atomic creation"):
            boundary.storage.save_if_absent("private.pem", b"key material")
        boundary.write.assert_not_called()
    else:
        assert boundary.storage.save_if_absent("private.pem", b"key material")
        for name, expected in boundary.condition.items():
            assert boundary.write.call_args.kwargs[name] == expected
        boundary.read.assert_not_called()


def test_creation_conflicts_are_distinct_from_backend_faults(boundary: _Boundary) -> None:
    if boundary.existing is not None:
        boundary.write.side_effect = boundary.existing
        assert not boundary.storage.save_if_absent("private.pem", b"candidate")
        boundary.write.side_effect = boundary.failure
        with pytest.raises(OSError, match="atomic creation failed"):
            boundary.storage.save_if_absent("private.pem", b"candidate")
    else:
        with pytest.raises(NotImplementedError, match="atomic creation"):
            boundary.storage.save_if_absent("private.pem", b"candidate")
        boundary.write.assert_not_called()


@pytest.mark.parametrize(
    ("status", "code", "missing"),
    [(404, "NoSuchKey", True), (403, "AccessDenied", False), (503, "ServiceUnavailable", False)],
)
def test_obs_checks_status_before_reading_body(status: int, code: str, missing: bool) -> None:
    storage = object.__new__(HuaweiObsStorage)
    storage.bucket_name = "keys"
    storage.client = MagicMock()
    storage.client.getObject.return_value = SimpleNamespace(status=status, errorCode=code, body=None)
    with pytest.raises(OSError, match="File not found|read failed") as captured:
        storage.load_once("private.pem")
    assert isinstance(captured.value, FileNotFoundError) is missing


@pytest.mark.parametrize("code", ["NoSuchBucket", "not_found"])
def test_supabase_missing_bucket_is_not_missing_key(code: str) -> None:
    storage = object.__new__(SupabaseStorage)
    storage.bucket_name, storage.client = "keys", MagicMock()
    storage.client.storage.from_.return_value.download.side_effect = StorageApiError("Bucket not found", code, 404)
    with pytest.raises(OSError, match="read failed") as captured:
        storage.load_once("private.pem")
    assert not isinstance(captured.value, FileNotFoundError)
