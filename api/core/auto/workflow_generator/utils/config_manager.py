"""
Configuration Manager
Used to manage configurations and prompts
"""

import os
import time
from pathlib import Path
from typing import Any, Optional

import yaml


class ConfigManager:
    """Configuration manager for managing configurations"""

    def __init__(self, config_dir: str = "config"):
        """
        Initialize configuration manager

        Args:
            config_dir: Configuration directory path
        """
        self.config_dir = Path(config_dir)
        self.config: dict[str, Any] = {}
        self.last_load_time: float = 0
        self.reload_interval: float = 60  # Check every 60 seconds
        self._load_config()

    def _should_reload(self) -> bool:
        """Check if configuration needs to be reloaded"""
        return time.time() - self.last_load_time > self.reload_interval

    def _load_config(self) -> dict[str, Any]:
        """Load configuration files"""
        default_config = self._load_yaml(self.config_dir / "default.yaml")
        custom_config = self._load_yaml(self.config_dir / "custom.yaml")
        self.config = self._deep_merge(default_config, custom_config)
        self.last_load_time = time.time()
        return self.config

    @staticmethod
    def _load_yaml(path: Path) -> dict[str, Any]:
        """Load YAML file"""
        try:
            with open(path, encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        except FileNotFoundError:
            print(f"Warning: Config file not found at {path}")
            return {}
        except Exception as e:
            print(f"Error loading config file {path}: {e}")
            return {}

    @staticmethod
    def _deep_merge(dict1: dict, dict2: dict) -> dict:
        """Recursively merge two dictionaries"""
        result = dict1.copy()
        for key, value in dict2.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = ConfigManager._deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    def get(self, *keys: str, default: Any = None) -> Any:
        """
        Get configuration value

        Args:
            *keys: Configuration key path
            default: Default value

        Returns:
            Configuration value or default value
        """
        if self._should_reload():
            self._load_config()

        current = self.config
        for key in keys:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return default
        return current

    @property
    def workflow_generator(self) -> dict[str, Any]:
        """Get workflow generator configuration"""
        return self.get("workflow_generator", default={})

    @property
    def workflow_nodes(self) -> dict[str, Any]:
        """Get workflow nodes configuration"""
        return self.get("workflow_nodes", default={})

    @property
    def output(self) -> dict[str, Any]:
        """Get output configuration"""
        return self.get("output", default={})

    def get_output_path(self, filename: Optional[str] = None) -> str:
        """
        Get output file path

        Args:
            filename: Optional filename, uses default filename from config if not specified

        Returns:
            Complete output file path
        """
        output_config = self.output
        output_dir = output_config.get("dir", "output/")
        output_filename = filename or output_config.get("filename", "generated_workflow.yml")
        return os.path.join(output_dir, output_filename)

    def get_workflow_model(self, model_name: Optional[str] = None) -> dict[str, Any]:
        """
        Get workflow generation model configuration

        Args:
            model_name: Model name, uses default model if not specified

        Returns:
            Model configuration
        """
        models = self.workflow_generator.get("models", {})

        if not model_name:
            model_name = models.get("default")

        return models.get("available", {}).get(model_name, {})

    def get_llm_node_config(self) -> dict[str, Any]:
        """
        Get LLM node configuration

        Returns:
            LLM node configuration
        """
        return self.workflow_nodes.get("llm", {})
