#!/usr/bin/env python3

import json
from pathlib import Path
from typing import Any


class ConfigHelper:
    """Helper class for reading and writing configuration files."""

    def __init__(self, base_dir: Path | None = None):
        """Initialize ConfigHelper with base directory.

        Args:
            base_dir: Base directory for config files. If None, uses setup/config
        """
        if base_dir is None:
            # Default to config directory in setup folder
            base_dir = Path(__file__).parent.parent / "setup" / "config"
        self.base_dir = base_dir
        self.state_file = "stress_test_state.json"

    def ensure_config_dir(self) -> None:
        """Ensure the config directory exists."""
        self.base_dir.mkdir(exist_ok=True, parents=True)

    def get_config_path(self, filename: str) -> Path:
        """Get the full path for a config file.

        Args:
            filename: Name of the config file (e.g., 'admin_config.json')

        Returns:
            Full path to the config file
        """
        if not filename.endswith(".json"):
            filename += ".json"
        return self.base_dir / filename

    def read_config(self, filename: str) -> dict[str, Any] | None:
        """Read a configuration file.

        DEPRECATED: Use read_state() or get_state_section() for new code.
        This method provides backward compatibility.

        Args:
            filename: Name of the config file to read

        Returns:
            Dictionary containing config data, or None if file doesn't exist
        """
        # Provide backward compatibility for old config names
        if filename in ["admin_config", "token_config", "app_config", "api_key_config"]:
            section_map = {
                "admin_config": "admin",
                "token_config": "auth",
                "app_config": "app",
                "api_key_config": "api_key",
            }
            return self.get_state_section(section_map[filename])

        config_path = self.get_config_path(filename)

        if not config_path.exists():
            return None

        try:
            with open(config_path) as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"❌ Error reading {filename}: {e}")
            return None

    def write_config(self, filename: str, data: dict[str, Any]) -> bool:
        """Write data to a configuration file.

        DEPRECATED: Use write_state() or update_state_section() for new code.
        This method provides backward compatibility.

        Args:
            filename: Name of the config file to write
            data: Dictionary containing data to save

        Returns:
            True if successful, False otherwise
        """
        # Provide backward compatibility for old config names
        if filename in ["admin_config", "token_config", "app_config", "api_key_config"]:
            section_map = {
                "admin_config": "admin",
                "token_config": "auth",
                "app_config": "app",
                "api_key_config": "api_key",
            }
            return self.update_state_section(section_map[filename], data)

        self.ensure_config_dir()
        config_path = self.get_config_path(filename)

        try:
            with open(config_path, "w") as f:
                json.dump(data, f, indent=2)
            return True
        except OSError as e:
            print(f"❌ Error writing {filename}: {e}")
            return False

    def config_exists(self, filename: str) -> bool:
        """Check if a config file exists.

        Args:
            filename: Name of the config file to check

        Returns:
            True if file exists, False otherwise
        """
        return self.get_config_path(filename).exists()

    def delete_config(self, filename: str) -> bool:
        """Delete a configuration file.

        Args:
            filename: Name of the config file to delete

        Returns:
            True if successful, False otherwise
        """
        config_path = self.get_config_path(filename)

        if not config_path.exists():
            return True  # Already doesn't exist

        try:
            config_path.unlink()
            return True
        except OSError as e:
            print(f"❌ Error deleting {filename}: {e}")
            return False

    def read_state(self) -> dict[str, Any] | None:
        """Read the entire stress test state.

        Returns:
            Dictionary containing all state data, or None if file doesn't exist
        """
        state_path = self.get_config_path(self.state_file)
        if not state_path.exists():
            return None

        try:
            with open(state_path) as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"❌ Error reading {self.state_file}: {e}")
            return None

    def write_state(self, data: dict[str, Any]) -> bool:
        """Write the entire stress test state.

        Args:
            data: Dictionary containing all state data to save

        Returns:
            True if successful, False otherwise
        """
        self.ensure_config_dir()
        state_path = self.get_config_path(self.state_file)

        try:
            with open(state_path, "w") as f:
                json.dump(data, f, indent=2)
            return True
        except OSError as e:
            print(f"❌ Error writing {self.state_file}: {e}")
            return False

    def update_state_section(self, section: str, data: dict[str, Any]) -> bool:
        """Update a specific section of the stress test state.

        Args:
            section: Name of the section to update (e.g., 'admin', 'auth', 'app', 'api_key')
            data: Dictionary containing section data to save

        Returns:
            True if successful, False otherwise
        """
        state = self.read_state() or {}
        state[section] = data
        return self.write_state(state)

    def get_state_section(self, section: str) -> dict[str, Any] | None:
        """Get a specific section from the stress test state.

        Args:
            section: Name of the section to get (e.g., 'admin', 'auth', 'app', 'api_key')

        Returns:
            Dictionary containing section data, or None if not found
        """
        state = self.read_state()
        if state:
            return state.get(section)
        return None

    def get_token(self) -> str | None:
        """Get the access token from auth section.

        Returns:
            Access token string or None if not found
        """
        auth = self.get_state_section("auth")
        if auth:
            return auth.get("access_token")
        return None

    def get_app_id(self) -> str | None:
        """Get the app ID from app section.

        Returns:
            App ID string or None if not found
        """
        app = self.get_state_section("app")
        if app:
            return app.get("app_id")
        return None

    def get_api_key(self) -> str | None:
        """Get the API key token from api_key section.

        Returns:
            API key token string or None if not found
        """
        api_key = self.get_state_section("api_key")
        if api_key:
            return api_key.get("token")
        return None


# Create a default instance for convenience
config_helper = ConfigHelper()
