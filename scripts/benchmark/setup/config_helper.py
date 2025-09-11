#!/usr/bin/env python3

import json
from pathlib import Path
from typing import Any, Optional


class ConfigHelper:
    """Helper class for reading and writing configuration files."""

    def __init__(self, base_dir: Optional[Path] = None):
        """Initialize ConfigHelper with base directory.

        Args:
            base_dir: Base directory for config files. If None, uses script's parent/config
        """
        if base_dir is None:
            # Default to config directory in the same folder as the calling script
            base_dir = Path(__file__).parent / "config"
        self.base_dir = base_dir

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

    def read_config(self, filename: str) -> Optional[dict[str, Any]]:
        """Read a configuration file.

        Args:
            filename: Name of the config file to read

        Returns:
            Dictionary containing config data, or None if file doesn't exist
        """
        config_path = self.get_config_path(filename)

        if not config_path.exists():
            return None

        try:
            with open(config_path, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"❌ Error reading {filename}: {e}")
            return None

    def write_config(self, filename: str, data: dict[str, Any]) -> bool:
        """Write data to a configuration file.

        Args:
            filename: Name of the config file to write
            data: Dictionary containing data to save

        Returns:
            True if successful, False otherwise
        """
        self.ensure_config_dir()
        config_path = self.get_config_path(filename)

        try:
            with open(config_path, "w") as f:
                json.dump(data, f, indent=2)
            return True
        except IOError as e:
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
        except IOError as e:
            print(f"❌ Error deleting {filename}: {e}")
            return False

    def get_token(self) -> Optional[str]:
        """Get the access token from token config.

        Returns:
            Access token string or None if not found
        """
        token_config = self.read_config("token_config")
        if token_config:
            return token_config.get("access_token")
        return None

    def get_app_id(self) -> Optional[str]:
        """Get the app ID from app config.

        Returns:
            App ID string or None if not found
        """
        app_config = self.read_config("app_config")
        if app_config:
            return app_config.get("app_id")
        return None

    def get_api_key(self) -> Optional[str]:
        """Get the API key token from api_key config.

        Returns:
            API key token string or None if not found
        """
        api_key_config = self.read_config("api_key_config")
        if api_key_config:
            return api_key_config.get("token")
        return None


# Create a default instance for convenience
config_helper = ConfigHelper()
