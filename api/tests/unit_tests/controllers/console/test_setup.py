from types import SimpleNamespace
from unittest.mock import patch

from controllers.console.setup import SetupApi


class TestSetupApi:
    def test_post_lowercases_email_before_register(self):
        """Ensure setup registration normalizes email casing."""
        payload = {
            "email": "Admin@Example.com",
            "name": "Admin User",
            "password": "ValidPass123!",
            "language": "en-US",
        }
        setup_api = SetupApi(api=None)

        mock_console_ns = SimpleNamespace(payload=payload)

        with (
            patch("controllers.console.setup.console_ns", mock_console_ns),
            patch("controllers.console.setup.get_setup_status", return_value=False),
            patch("controllers.console.setup.TenantService.get_tenant_count", return_value=0),
            patch("controllers.console.setup.get_init_validate_status", return_value=True),
            patch("controllers.console.setup.extract_remote_ip", return_value="127.0.0.1"),
            patch("controllers.console.setup.request", object()),
            patch("controllers.console.setup.RegisterService.setup") as mock_register,
        ):
            response, status = setup_api.post()

        assert response == {"result": "success"}
        assert status == 201
        mock_register.assert_called_once_with(
            email="admin@example.com",
            name=payload["name"],
            password=payload["password"],
            ip_address="127.0.0.1",
            language=payload["language"],
        )
