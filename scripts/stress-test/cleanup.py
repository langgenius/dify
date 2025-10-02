#!/usr/bin/env python3

import shutil
import sys
from pathlib import Path

from common import Logger


def cleanup() -> None:
    """Clean up all configuration files and reports created during setup and stress testing."""

    log = Logger("Cleanup")
    log.header("Stress Test Cleanup")

    config_dir = Path(__file__).parent / "setup" / "config"
    reports_dir = Path(__file__).parent / "reports"

    dirs_to_clean = []
    if config_dir.exists():
        dirs_to_clean.append(config_dir)
    if reports_dir.exists():
        dirs_to_clean.append(reports_dir)

    if not dirs_to_clean:
        log.success("No directories to clean. Everything is already clean.")
        return

    log.info("Cleaning up stress test data...")
    log.info("This will remove:")
    for dir_path in dirs_to_clean:
        log.list_item(str(dir_path))

    # List files that will be deleted
    log.separator()
    if config_dir.exists():
        config_files = list(config_dir.glob("*.json"))
        if config_files:
            log.info("Config files to be removed:")
            for file in config_files:
                log.list_item(file.name)

    if reports_dir.exists():
        report_files = list(reports_dir.glob("*"))
        if report_files:
            log.info("Report files to be removed:")
            for file in report_files:
                log.list_item(file.name)

    # Ask for confirmation if running interactively
    if sys.stdin.isatty():
        log.separator()
        log.warning("This action cannot be undone!")
        confirmation = input("Are you sure you want to remove all config and report files? (yes/no): ")

        if confirmation.lower() not in ["yes", "y"]:
            log.error("Cleanup cancelled.")
            return

    try:
        # Remove directories and all their contents
        for dir_path in dirs_to_clean:
            shutil.rmtree(dir_path)
            log.success(f"{dir_path.name} directory removed successfully!")

        log.separator()
        log.info("To run the setup again, execute:")
        log.list_item("python setup_all.py")
        log.info("Or run scripts individually in this order:")
        log.list_item("python setup/mock_openai_server.py (in a separate terminal)")
        log.list_item("python setup/setup_admin.py")
        log.list_item("python setup/login_admin.py")
        log.list_item("python setup/install_openai_plugin.py")
        log.list_item("python setup/configure_openai_plugin.py")
        log.list_item("python setup/import_workflow_app.py")
        log.list_item("python setup/create_api_key.py")
        log.list_item("python setup/publish_workflow.py")
        log.list_item("python setup/run_workflow.py")

    except PermissionError as e:
        log.error(f"Permission denied: {e}")
        log.info("Try running with appropriate permissions.")
    except Exception as e:
        log.error(f"An error occurred during cleanup: {e}")


if __name__ == "__main__":
    cleanup()
