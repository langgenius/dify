#!/usr/bin/env python3

import shutil
import sys
from pathlib import Path

from common import Logger


def cleanup() -> None:
    """Clean up all configuration files created during setup."""

    log = Logger("Cleanup")
    log.header("Configuration Cleanup")

    config_dir = Path(__file__).parent / "setup" / "config"

    if not config_dir.exists():
        log.success("Config directory does not exist. Nothing to clean.")
        return

    log.info("Cleaning up configuration files...")
    log.info(f"This will remove: {config_dir}")

    # List files that will be deleted
    config_files = list(config_dir.glob("*.json"))
    if config_files:
        log.separator()
        log.info("Files to be removed:")
        for file in config_files:
            log.list_item(file.name)

    # Ask for confirmation if running interactively
    if sys.stdin.isatty():
        log.separator()
        log.warning("This action cannot be undone!")
        confirmation = input(
            "Are you sure you want to remove all config files? (yes/no): "
        )

        if confirmation.lower() not in ["yes", "y"]:
            log.error("Cleanup cancelled.")
            return

    try:
        # Remove the config directory and all its contents
        shutil.rmtree(config_dir)
        log.success("Config directory removed successfully!")

        log.separator()
        log.info("To run the setup again, execute the scripts in this order:")
        log.list_item("python mock_openai_server.py (in a separate terminal)")
        log.list_item("python setup_admin.py")
        log.list_item("python login_admin.py")
        log.list_item("python install_openai_plugin.py")
        log.list_item("python configure_openai_plugin.py")
        log.list_item("python import_workflow_app.py")
        log.list_item("python create_api_key.py")
        log.list_item("python publish_workflow.py")
        log.list_item("python run_workflow.py")

    except PermissionError:
        log.error("Permission denied. Unable to remove config directory.")
        log.info("Try running with appropriate permissions.")
    except Exception as e:
        log.error(f"An error occurred during cleanup: {e}")


if __name__ == "__main__":
    cleanup()
