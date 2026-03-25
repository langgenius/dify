#!/usr/bin/env python3

# ================================================================
# Dify Environment Variables Synchronization Script
#
# Features:
# - Synchronize latest settings from .env.example to .env
# - Preserve custom settings in existing .env
# - Add new environment variables
# - Detect removed environment variables
# - Create backup files
# ================================================================

import argparse
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

# ANSI color codes
RED = "\033[0;31m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
BLUE = "\033[0;34m"
NC = "\033[0m"  # No Color


def supports_color() -> bool:
    """Return True if the terminal supports ANSI color codes."""
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


def log_info(message: str) -> None:
    """Print an informational message in blue."""
    if supports_color():
        print(f"{BLUE}[INFO]{NC} {message}")
    else:
        print(f"[INFO] {message}")


def log_success(message: str) -> None:
    """Print a success message in green."""
    if supports_color():
        print(f"{GREEN}[SUCCESS]{NC} {message}")
    else:
        print(f"[SUCCESS] {message}")


def log_warning(message: str) -> None:
    """Print a warning message in yellow to stderr."""
    if supports_color():
        print(f"{YELLOW}[WARNING]{NC} {message}", file=sys.stderr)
    else:
        print(f"[WARNING] {message}", file=sys.stderr)


def log_error(message: str) -> None:
    """Print an error message in red to stderr."""
    if supports_color():
        print(f"{RED}[ERROR]{NC} {message}", file=sys.stderr)
    else:
        print(f"[ERROR] {message}", file=sys.stderr)


def parse_env_file(path: Path) -> dict[str, str]:
    """Parse an .env-style file and return a mapping of key to raw value.

    Lines that are blank or start with '#' (after optional whitespace) are
    skipped.  Only lines containing '=' are considered variable definitions.

    Args:
        path: Path to the .env file to parse.

    Returns:
        Ordered dict mapping variable name to its value string.
    """
    variables: dict[str, str] = {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            # Skip blank lines and comment lines
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key:
                variables[key] = value.strip()
    return variables


def check_files(work_dir: Path) -> None:
    """Verify required files exist; create .env from .env.example if absent.

    Args:
        work_dir: Directory that must contain .env.example (and optionally .env).

    Raises:
        SystemExit: If .env.example does not exist.
    """
    log_info("Checking required files...")

    example_file = work_dir / ".env.example"
    env_file = work_dir / ".env"

    if not example_file.exists():
        log_error(".env.example file not found")
        sys.exit(1)

    if not env_file.exists():
        log_warning(".env file does not exist. Creating from .env.example.")
        shutil.copy2(example_file, env_file)
        log_success(".env file created")

    log_success("Required files verified")


def create_backup(work_dir: Path) -> None:
    """Create a timestamped backup of the current .env file.

    Backups are placed in ``<work_dir>/env-backup/`` with the filename
    ``.env.backup_<YYYYMMDD_HHMMSS>``.

    Args:
        work_dir: Directory containing the .env file to back up.
    """
    env_file = work_dir / ".env"
    if not env_file.exists():
        return

    backup_dir = work_dir / "env-backup"
    if not backup_dir.exists():
        backup_dir.mkdir(parents=True)
        log_info(f"Created backup directory: {backup_dir}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f".env.backup_{timestamp}"
    shutil.copy2(env_file, backup_file)
    log_success(f"Backed up existing .env to {backup_file}")


def analyze_value_change(current: str, recommended: str) -> str | None:
    """Analyse what kind of change occurred between two env values.

    Args:
        current: Value currently set in .env.
        recommended: Value present in .env.example.

    Returns:
        A human-readable description string, or None when no analysis applies.
    """
    use_colors = supports_color()

    def colorize(color: str, text: str) -> str:
        return f"{color}{text}{NC}" if use_colors else text

    if not current and recommended:
        return colorize(RED, "  -> Setting from empty to recommended value")
    if current and not recommended:
        return colorize(RED, "  -> Recommended value changed to empty")

    # Numeric comparison
    if re.fullmatch(r"\d+", current) and re.fullmatch(r"\d+", recommended):
        cur_int, rec_int = int(current), int(recommended)
        if cur_int < rec_int:
            return colorize(BLUE, f"  -> Numeric increase ({current} < {recommended})")
        if cur_int > rec_int:
            return colorize(YELLOW, f"  -> Numeric decrease ({current} > {recommended})")
        return None

    # Boolean comparison
    if current.lower() in {"true", "false"} and recommended.lower() in {"true", "false"}:
        if current.lower() != recommended.lower():
            return colorize(BLUE, f"  -> Boolean value change ({current} -> {recommended})")
        return None

    # URL / endpoint
    if current.startswith(("http://", "https://")) or recommended.startswith(("http://", "https://")):
        return colorize(BLUE, "  -> URL/endpoint change")

    # File path
    if current.startswith("/") or recommended.startswith("/"):
        return colorize(BLUE, "  -> File path change")

    # String length
    if len(current) != len(recommended):
        return colorize(YELLOW, f"  -> String length change ({len(current)} -> {len(recommended)} characters)")

    return None


def detect_differences(env_vars: dict[str, str], example_vars: dict[str, str]) -> dict[str, tuple[str, str]]:
    """Find variables whose values differ between .env and .env.example.

    Only variables present in *both* files are compared; new or removed
    variables are handled by separate functions.

    Args:
        env_vars: Parsed key/value pairs from .env.
        example_vars: Parsed key/value pairs from .env.example.

    Returns:
        Mapping of key -> (env_value, example_value) for every key whose
        values differ.
    """
    log_info("Detecting differences between .env and .env.example...")

    diffs: dict[str, tuple[str, str]] = {}
    for key, example_value in example_vars.items():
        if key in env_vars and env_vars[key] != example_value:
            diffs[key] = (env_vars[key], example_value)

    if diffs:
        log_success(f"Detected differences in {len(diffs)} environment variables")
        show_differences_detail(diffs)
    else:
        log_info("No differences detected")

    return diffs


def show_differences_detail(diffs: dict[str, tuple[str, str]]) -> None:
    """Print a formatted table of differing environment variables.

    Args:
        diffs: Mapping of key -> (current_value, recommended_value).
    """
    use_colors = supports_color()

    log_info("")
    log_info("=== Environment Variable Differences ===")

    if not diffs:
        log_info("No differences to display")
        return

    for count, (key, (env_value, example_value)) in enumerate(diffs.items(), start=1):
        print()
        if use_colors:
            print(f"{YELLOW}[{count}] {key}{NC}")
            print(f"  {GREEN}.env (current){NC}             : {env_value}")
            print(f"  {BLUE}.env.example (recommended){NC} : {example_value}")
        else:
            print(f"[{count}] {key}")
            print(f"  .env (current)             : {env_value}")
            print(f"  .env.example (recommended) : {example_value}")

        analysis = analyze_value_change(env_value, example_value)
        if analysis:
            print(analysis)

    print()
    log_info("=== Difference Analysis Complete ===")
    log_info("Note: Consider changing to the recommended values above.")
    log_info("Current implementation preserves .env values.")
    print()


def detect_removed_variables(env_vars: dict[str, str], example_vars: dict[str, str]) -> list[str]:
    """Identify variables present in .env but absent from .env.example.

    Args:
        env_vars: Parsed key/value pairs from .env.
        example_vars: Parsed key/value pairs from .env.example.

    Returns:
        Sorted list of variable names that no longer appear in .env.example.
    """
    log_info("Detecting removed environment variables...")

    removed = sorted(set(env_vars) - set(example_vars))

    if removed:
        log_warning("The following environment variables have been removed from .env.example:")
        for var in removed:
            log_warning(f"  - {var}")
        log_warning("Consider manually removing these variables from .env")
    else:
        log_success("No removed environment variables found")

    return removed


def sync_env_file(work_dir: Path, env_vars: dict[str, str], diffs: dict[str, tuple[str, str]]) -> None:
    """Rewrite .env based on .env.example while preserving custom values.

    The output file follows the exact line structure of .env.example
    (preserving comments, blank lines, and ordering).  For every variable
    that exists in .env with a different value from the example, the
    current .env value is kept.  Variables that are new in .env.example
    (not present in .env at all) are added with the example's default.

    Args:
        work_dir: Directory containing .env and .env.example.
        env_vars: Parsed key/value pairs from the original .env.
        diffs: Keys whose .env values differ from .env.example (to preserve).
    """
    log_info("Starting partial synchronization of .env file...")

    example_file = work_dir / ".env.example"
    new_env_file = work_dir / ".env.new"

    # Keys whose current .env value should override the example default
    preserved_keys: set[str] = set(diffs.keys())

    preserved_count = 0
    updated_count = 0

    env_var_pattern = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=")

    with example_file.open(encoding="utf-8") as src, new_env_file.open("w", encoding="utf-8") as dst:
        for line in src:
            raw_line = line.rstrip("\n")
            match = env_var_pattern.match(raw_line)
            if match:
                key = match.group(1)
                if key in preserved_keys:
                    # Write the preserved value from .env
                    dst.write(f"{key}={env_vars[key]}\n")
                    log_info(f"  Preserved: {key} (.env value)")
                    preserved_count += 1
                else:
                    # Use the example value (covers new vars and unchanged ones)
                    dst.write(line if line.endswith("\n") else raw_line + "\n")
                    updated_count += 1
            else:
                # Blank line, comment, or non-variable line — keep as-is
                dst.write(line if line.endswith("\n") else raw_line + "\n")

    # Atomically replace the original .env
    try:
        new_env_file.replace(work_dir / ".env")
    except OSError as exc:
        log_error(f"Failed to replace .env file: {exc}")
        new_env_file.unlink(missing_ok=True)
        sys.exit(1)

    log_success("Successfully created new .env file")
    log_success("Partial synchronization of .env file completed")
    log_info(f"  Preserved .env values: {preserved_count}")
    log_info(f"  Updated to .env.example values: {updated_count}")


def show_statistics(work_dir: Path) -> None:
    """Print a summary of variable counts from both env files.

    Args:
        work_dir: Directory containing .env and .env.example.
    """
    log_info("Synchronization statistics:")

    example_file = work_dir / ".env.example"
    env_file = work_dir / ".env"

    example_count = len(parse_env_file(example_file)) if example_file.exists() else 0
    env_count = len(parse_env_file(env_file)) if env_file.exists() else 0

    log_info(f"  .env.example environment variables: {example_count}")
    log_info(f"  .env environment variables: {env_count}")


def build_arg_parser() -> argparse.ArgumentParser:
    """Build and return the CLI argument parser.

    Returns:
        Configured ArgumentParser instance.
    """
    parser = argparse.ArgumentParser(
        prog="dify-env-sync",
        description=(
            "Synchronize .env with .env.example: add new variables, "
            "preserve custom values, and report removed variables."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  # Run from the docker/ directory (default)\n"
            "  python dify-env-sync.py\n\n"
            "  # Specify a custom working directory\n"
            "  python dify-env-sync.py --dir /path/to/docker\n"
        ),
    )
    parser.add_argument(
        "--dir",
        metavar="DIRECTORY",
        default=".",
        help="Working directory containing .env and .env.example (default: current directory)",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        default=False,
        help="Skip creating a timestamped backup of the existing .env file",
    )
    return parser


def main() -> None:
    """Orchestrate the complete environment variable synchronization process."""
    parser = build_arg_parser()
    args = parser.parse_args()

    work_dir = Path(args.dir).resolve()

    log_info("=== Dify Environment Variables Synchronization Script ===")
    log_info(f"Execution started: {datetime.now()}")
    log_info(f"Working directory: {work_dir}")

    # 1. Verify prerequisites
    check_files(work_dir)

    # 2. Backup existing .env
    if not args.no_backup:
        create_backup(work_dir)

    # 3. Parse both files
    env_vars = parse_env_file(work_dir / ".env")
    example_vars = parse_env_file(work_dir / ".env.example")

    # 4. Report differences (values that changed in the example)
    diffs = detect_differences(env_vars, example_vars)

    # 5. Report variables removed from the example
    detect_removed_variables(env_vars, example_vars)

    # 6. Rewrite .env
    sync_env_file(work_dir, env_vars, diffs)

    # 7. Print summary statistics
    show_statistics(work_dir)

    log_success("=== Synchronization process completed successfully ===")
    log_info(f"Execution finished: {datetime.now()}")


if __name__ == "__main__":
    main()
