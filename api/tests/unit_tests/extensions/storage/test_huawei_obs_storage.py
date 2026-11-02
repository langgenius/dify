from unittest.mock import MagicMock, patch

from configs import dify_config
from extensions.storage.huawei_obs_storage import HuaweiObsStorage


def test_init_uses_oidc_provider() -> None:
    with (
        patch.object(dify_config, "HUAWEI_OBS_USE_OIDC", True),
        patch.object(dify_config, "HUAWEI_OBS_SERVER", "https://obs.example.com"),
        patch("extensions.storage.huawei_obs_storage.ObsClient") as obs_client,
    ):
        obs_client.return_value = MagicMock()
        HuaweiObsStorage()

    obs_client.assert_called_once_with(
        server="https://obs.example.com",
        path_style=False,
        security_provider_policy="OIDC",
    )
