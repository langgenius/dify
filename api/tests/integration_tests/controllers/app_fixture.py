import pytest

from app_factory import create_app
from configs import dify_config

mock_user = type(
    "MockUser",
    (object,),
    {
        "is_authenticated": True,
        "id": "123",
        "is_editor": True,
        "is_dataset_editor": True,
        "status": "active",
        "get_id": "123",
        "current_tenant_id": "9d2074fc-6f86-45a9-b09d-6ecc63b9056b",
    },
)


@pytest.fixture
def app():
    app = create_app()
    dify_config.LOGIN_DISABLED = True
    return app
