#!/usr/bin/env python3
"""
Automated typing error fixer using progressive refinement strategy.
"""

import json
import re
import subprocess
import time
from collections import deque
from pathlib import Path
from typing import Any


class PyrightConfigManager:
    """Manages pyrightconfig.json exclude list."""

    def __init__(self, config_path: str = "api/pyrightconfig.json"):
        self.config_path = config_path

    def _read_config(self) -> dict[str, Any]:
        """Read the current pyrightconfig.json."""
        with open(self.config_path, 'r') as f:
            return json.load(f)

    def _write_config(self, config: dict[str, Any]) -> None:
        """Write the updated pyrightconfig.json."""
        with open(self.config_path, 'w') as f:
            json.dump(config, f, indent=2)

    def remove_from_exclude(self, path: str) -> None:
        """Remove path from 'exclude' part of pyrightconfig.json."""
        if path.startswith('api/'):
            path = path[4:]  # Remove 'api/' prefix

        config = self._read_config()
        if path in config.get('exclude', []):
            config['exclude'].remove(path)
            self._write_config(config)
            print(f"✓ Removed '{path}' from exclude list")

    def add_to_exclude(self, path: str) -> None:
        """Add path to 'exclude' part of pyrightconfig.json."""
        if path.startswith('api/'):
            path = path[4:]  # Remove 'api/' prefix

        config = self._read_config()
        if 'exclude' not in config:
            config['exclude'] = []
        if path not in config['exclude']:
            config['exclude'].append(path)
            self._write_config(config)
            print(f"✓ Added '{path}' to exclude list")


class TypeCheckingRunner:
    """Handles type checking execution and error parsing."""

    def run_type_checking(self) -> tuple[int, bool]:
        """
        Run type checking and analyze errors.
        Returns: (error_count, is_single_file)
        """
        print("\n🔍 Running type checking...")
        result = subprocess.run(
            ["./dev/basedpyright-check"],
            capture_output=True,
            text=True
        )

        output = result.stdout + result.stderr

        # Parse error count
        error_match = re.search(r'(\d+)\s+error', output)
        error_count = int(error_match.group(1)) if error_match else 0

        # Check if errors are from a single file
        file_pattern = re.findall(r'api/[^:]+\.py', output)
        unique_files = set(file_pattern)
        is_single_file = len(unique_files) == 1

        print(f"  Found {error_count} errors in {len(unique_files)} file(s)")

        return error_count, is_single_file

    def fix_errors_with_claude(self, path: str) -> None:
        """Start a Claude Code instance to fix typing errors."""
        prompt = f"""Fix all typing errors in the path '{path}'.
        
        Run './dev/basedpyright-check' to see the errors, then fix them.
        
        Important guidelines for fixing typing errors:
        - DO NOT use bypass methods like cast(), Any, type: ignore, or similar workarounds
        - Use isinstance() checks for runtime type validation
        - For complex types, use or create TypeGuard functions in api/libs/typing.py
        - Add proper type annotations that accurately reflect the actual types
        - Preserve the existing functionality while adding proper type annotations
        - Focus on understanding the actual data flow and types rather than suppressing errors
        
        After fixing all typing errors, create a git commit with the message:
        'fix: resolve typing errors in {path}'
        
        Make sure all errors are properly fixed before committing."""

        print(f"\n🤖 Starting Claude Code to fix errors in '{path}'...")
        subprocess.run(
            ["claude", prompt, "--dangerously-skip-permissions"],
            check=True
        )


class PathBreakdown:
    """Handles breaking down paths into smaller components."""

    def break_down_path(self, path: str, config_manager: PyrightConfigManager) -> list[str]:
        """Separate path into more detailed paths."""
        full_path = f"api/{path}" if not path.startswith('api/') else path

        # Check if it's a file or directory
        path_obj = Path(full_path)

        if not path_obj.exists():
            print(f"⚠️  Path '{full_path}' does not exist")
            return []

        subpaths = []

        if path_obj.is_file():
            # If it's a file, can't break down further
            return [path]

        # List subdirectories and Python files
        for item in path_obj.iterdir():
            if item.is_dir() and not item.name.startswith('.'):
                relative_path = str(item.relative_to('api'))
                subpaths.append(relative_path)
                config_manager.add_to_exclude(relative_path)
            elif item.suffix == '.py':
                relative_path = str(item.relative_to('api'))
                subpaths.append(relative_path)
                config_manager.add_to_exclude(relative_path)

        # Remove the parent path from exclude list
        config_manager.remove_from_exclude(path)

        print(f"  Broke down '{path}' into {len(subpaths)} subpaths")
        return subpaths


def main():
    """Main processing logic with queue-based approach."""
    config_manager = PyrightConfigManager()
    type_checker = TypeCheckingRunner()
    path_breakdown = PathBreakdown()

    # Initialize queue with starting path
    paths_queue = deque(["configs"])

    print("🚀 Starting automated typing error fix process")
    print("=" * 60)

    while paths_queue:
        current_path = paths_queue.popleft()
        print(f"\n📦 Processing: '{current_path}'")

        # Remove from exclude to check this path
        config_manager.remove_from_exclude(current_path)

        # Run type checking
        error_count, is_single_file = type_checker.run_type_checking()

        if error_count == 0:
            print(f"  ✅ No errors in '{current_path}'")
            continue

        # Decide whether to fix or break down further
        if error_count < 50 or is_single_file:
            print(f"  🔧 Attempting to fix {error_count} errors...")
            type_checker.fix_errors_with_claude(current_path)

            # Wait for user to confirm completion
            input("\n⏸️  Press Enter after Claude Code has finished fixing errors...")

            # Verify fixes
            error_count_after, _ = type_checker.run_type_checking()
            if error_count_after == 0:
                print(f"  ✅ Successfully fixed all errors in '{current_path}'")
            else:
                print(f"  ⚠️  {error_count_after} errors remaining in '{current_path}'")
        else:
            print(f"  📂 Too many errors ({error_count}), breaking down path...")
            subpaths = path_breakdown.break_down_path(current_path, config_manager)

            # Add subpaths to queue
            for subpath in subpaths:
                paths_queue.append(subpath)
                print(f"    → Added '{subpath}' to queue")

    print("\n" + "=" * 60)
    print("🎉 Typing error fix process completed!")

    # Final verification
    print("\n🔍 Running final type check on entire codebase...")
    # Remove all excludes for final check
    config = config_manager._read_config()
    original_excludes = config.get('exclude', []).copy()
    config['exclude'] = ['tests/', 'migrations/', '.venv/']  # Keep only essential excludes
    config_manager._write_config(config)

    final_errors, _ = type_checker.run_type_checking()
    if final_errors == 0:
        print("✨ All typing errors have been fixed!")
    else:
        print(f"⚠️  {final_errors} errors still remain. Manual intervention may be required.")

    # Restore original excludes
    config['exclude'] = original_excludes
    config_manager._write_config(config)


if __name__ == "__main__":
    main()
