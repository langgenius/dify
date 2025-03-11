"""
Debug Manager
Used to manage debug information saving
"""

import datetime
import json
import os
import uuid
from typing import Any, Optional, Union


class DebugManager:
    """Debug manager for managing debug information saving"""

    _instance = None

    def __new__(cls, *args, **kwargs):
        """Singleton pattern"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, config: dict[str, Any] = {}, debug_enabled: bool = False):
        """
        Initialize debug manager

        Args:
            config: Debug configuration
            debug_enabled: Whether to enable debug mode
        """
        # Avoid repeated initialization
        if self._initialized:
            return

        self._initialized = True
        self.config = config or {}
        self.debug_enabled = debug_enabled or self.config.get("enabled", False)
        self.debug_dir = self.config.get("dir", "debug/")
        self.save_options = self.config.get(
            "save_options", {"prompt": True, "response": True, "json": True, "workflow": True}
        )

        # Generate run ID
        self.case_id = self._generate_case_id()
        self.case_dir = os.path.join(self.debug_dir, self.case_id)

        # If debug is enabled, create debug directory
        if self.debug_enabled:
            os.makedirs(self.case_dir, exist_ok=True)
            print(f"Debug mode enabled, debug information will be saved to: {self.case_dir}")

    def _generate_case_id(self) -> str:
        """
        Generate run ID

        Returns:
            Run ID
        """
        # Use format from configuration to generate run ID
        format_str = self.config.get("case_id_format", "%Y%m%d_%H%M%S_%f")
        timestamp = datetime.datetime.now().strftime(format_str)

        # Add random string
        random_str = str(uuid.uuid4())[:8]

        return f"{timestamp}_{random_str}"

    def save_text(self, content: str, filename: str, subdir: Optional[str] = None) -> Optional[str]:
        """
        Save text content to file

        Args:
            content: Text content
            filename: File name
            subdir: Subdirectory name

        Returns:
            Saved file path, returns None if debug is not enabled
        """
        if not self.debug_enabled:
            return None

        try:
            # Determine save path
            save_dir = self.case_dir
            if subdir:
                save_dir = os.path.join(save_dir, subdir)
                os.makedirs(save_dir, exist_ok=True)

            file_path = os.path.join(save_dir, filename)

            # Save content
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)

            print(f"Debug information saved to: {file_path}")
            return file_path
        except Exception as e:
            print(f"Failed to save debug information: {e}")
            return None

    def save_json(self, data: Union[dict, list], filename: str, subdir: Optional[str] = None) -> Optional[str]:
        """
        Save JSON data to file

        Args:
            data: JSON data
            filename: File name
            subdir: Subdirectory name

        Returns:
            Saved file path, returns None if debug is not enabled
        """
        if not self.debug_enabled:
            return None

        try:
            # Determine save path
            save_dir = self.case_dir
            if subdir:
                save_dir = os.path.join(save_dir, subdir)
                os.makedirs(save_dir, exist_ok=True)

            file_path = os.path.join(save_dir, filename)

            # Save content
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            print(f"Debug information saved to: {file_path}")
            return file_path
        except Exception as e:
            print(f"Failed to save debug information: {e}")
            return None

    def should_save(self, option: str) -> bool:
        """
        Check if specified type of debug information should be saved

        Args:
            option: Debug information type

        Returns:
            Whether it should be saved
        """
        if not self.debug_enabled:
            return False

        return self.save_options.get(option, False)
