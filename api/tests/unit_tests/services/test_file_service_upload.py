import importlib
import sys
import types
import uuid
from unittest.mock import patch

import pytest

from services.errors.file import UnsupportedFileTypeError


def _import_file_service_with_stubs():
    # Provide a lightweight stub for core.repositories to avoid heavy imports and circular refs
    core_repos_stub = types.ModuleType("core.repositories")

    class RepositoryImportError(Exception):
        pass

    class DifyCoreRepositoryFactory:  # minimal stub used only for import resolution
        pass

    core_repos_stub.RepositoryImportError = RepositoryImportError
    core_repos_stub.DifyCoreRepositoryFactory = DifyCoreRepositoryFactory

    sys.modules.setdefault("core.repositories", core_repos_stub)

    # Now import the target after stubbing
    mod = importlib.import_module("services.file_service")
    return mod, mod.FileService


class DummySession:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        pass


class DummySessionMaker:
    def __init__(self):
        self._session = DummySession()

    def __call__(self, expire_on_commit: bool = False):
        return self

    def __enter__(self):
        return self._session

    def __exit__(self, exc_type, exc, tb):
        return False


@pytest.fixture
def session_maker():
    return DummySessionMaker()


@pytest.fixture
def fixed_uuid():
    return uuid.UUID("00000000-0000-0000-0000-000000000001")


@pytest.fixture
def common_patches(fixed_uuid):
    mod, _ = _import_file_service_with_stubs()
    # Patch the imported sessionmaker symbol to our dummy to satisfy isinstance checks
    with (
        patch.object(mod, "sessionmaker", DummySessionMaker),
        patch.object(mod.storage, "save") as mock_storage_save,
        patch.object(mod.file_helpers, "get_signed_file_url", return_value="signed-url") as mock_signed_url,
        patch.object(mod, "extract_tenant_id", return_value="tenant-123") as mock_extract_tenant_id,
        patch.object(mod.uuid, "uuid4", return_value=fixed_uuid),
    ):
        yield {
            "storage_save": mock_storage_save,
            "signed_url": mock_signed_url,
            "extract_tenant_id": mock_extract_tenant_id,
        }


def _build_service(session_maker: DummySessionMaker):
    _, FileService = _import_file_service_with_stubs()
    return FileService(session_maker)


def _dummy_user():
    return types.SimpleNamespace(id="user-123")


# 1. derives category as 'knowledge' when source is 'datasets'


def test_upload_file_derives_knowledge_for_datasets(session_maker, common_patches):
    service = _build_service(session_maker)

    result = service.upload_file(
        filename="doc.txt",
        content=b"hello world",
        mimetype="text/plain",
        user=_dummy_user(),
        source="datasets",
        category=None,
    )

    # storage key should include derived category 'knowledge'
    assert result.key.startswith("upload_files/knowledge/tenant-123/")
    assert result.key.endswith(".txt")
    common_patches["storage_save"].assert_called_once()


# 2. uses the provided valid category when source is not 'datasets'


def test_upload_file_uses_valid_category_when_not_datasets(session_maker, common_patches):
    service = _build_service(session_maker)

    result = service.upload_file(
        filename="file.txt",
        content=b"data",
        mimetype="text/plain",
        user=_dummy_user(),
        source=None,
        category="public",
    )

    # category should be respected as 'public'
    assert result.key.startswith("upload_files/public/tenant-123/")
    assert result.key.endswith(".txt")


# 3. defaults to 'public' when invalid category provided and source is not 'datasets'


def test_upload_file_defaults_public_on_invalid_category(session_maker, common_patches):
    service = _build_service(session_maker)

    result = service.upload_file(
        filename="notes.txt",
        content=b"notes",
        mimetype="text/plain",
        user=_dummy_user(),
        source=None,
        category="invalid-category",
    )

    assert result.key.startswith("upload_files/public/tenant-123/")
    assert result.key.endswith(".txt")


# 4. raises UnsupportedFileTypeError when category is 'profiles' and file extension is not an image


def test_upload_file_profiles_rejects_non_image(session_maker, common_patches):
    service = _build_service(session_maker)

    with pytest.raises(UnsupportedFileTypeError):
        service.upload_file(
            filename="avatar.txt",  # not an image extension
            content=b"avatar",
            mimetype="text/plain",
            user=_dummy_user(),
            source=None,
            category="profiles",
        )

    # ensure storage not called on failure
    common_patches["storage_save"].assert_not_called()


# 5. correctly constructs the file_key with the derived category in the path


def test_upload_file_constructs_file_key_with_derived_category(session_maker, common_patches, fixed_uuid):
    service = _build_service(session_maker)

    # use datasets to force derived category = 'knowledge'
    result = service.upload_file(
        filename="paper.txt",
        content=b"content",
        mimetype="text/plain",
        user=_dummy_user(),
        source="datasets",
        category=None,
    )

    expected_key = f"upload_files/knowledge/tenant-123/{fixed_uuid}.txt"
    assert result.key == expected_key
