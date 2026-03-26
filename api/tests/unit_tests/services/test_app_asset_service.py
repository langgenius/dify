from types import SimpleNamespace

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode, AssetNodeType, BatchUploadNode
from core.app_assets.storage import AssetPaths
from services import app_asset_service
from services.app_asset_service import AppAssetService


class DummyLock:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class DummySession:
    committed: bool

    def __init__(self) -> None:
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def commit(self) -> None:
        self.committed = True


class DummyStorage:
    keys: list[str]

    def __init__(self) -> None:
        self.keys = []

    def get_upload_url(self, key: str, expires_in: int) -> str:
        self.keys.append(key)
        return f"https://upload.local/{key}?expires_in={expires_in}"


def test_batch_create_from_tree_creates_nodes_under_parent(monkeypatch):
    session = DummySession()
    storage = DummyStorage()
    tenant_id = "11111111-1111-4111-8111-111111111111"
    app_id = "22222222-2222-4222-8222-222222222222"
    parent_folder = AppAssetNode.create_folder("33333333-3333-4333-8333-333333333333", "existing-parent")
    assets = SimpleNamespace(asset_tree=AppAssetFileTree(nodes=[parent_folder]), updated_by=None)
    app_model = SimpleNamespace(id=app_id, tenant_id=tenant_id)

    monkeypatch.setattr(AppAssetService, "_lock", staticmethod(lambda _app_id: DummyLock()))
    monkeypatch.setattr(app_asset_service, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(app_asset_service, "Session", lambda *args, **kwargs: session)
    monkeypatch.setattr(
        AppAssetService,
        "get_or_create_assets",
        staticmethod(lambda _session, _app_model, _account_id: assets),
    )
    monkeypatch.setattr(AppAssetService, "get_storage", staticmethod(lambda: storage))

    result = AppAssetService.batch_create_from_tree(
        app_model,
        "account-1",
        [
            BatchUploadNode(
                name="docs",
                node_type=AssetNodeType.FOLDER,
                children=[
                    BatchUploadNode(name="guide.md", node_type=AssetNodeType.FILE, size=12),
                ],
            ),
        ],
        parent_id=parent_folder.id,
    )

    created_folder = next(node for node in assets.asset_tree.nodes if node.name == "docs")
    created_file = next(node for node in assets.asset_tree.nodes if node.name == "guide.md")

    assert created_folder.parent_id == parent_folder.id
    assert created_file.parent_id == created_folder.id
    assert created_file.id == result[0].children[0].id
    assert assets.updated_by == "account-1"
    assert session.committed is True
    assert storage.keys == [AssetPaths.draft(tenant_id, app_id, created_file.id)]
