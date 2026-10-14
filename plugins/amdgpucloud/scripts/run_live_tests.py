"""Opt-in launcher: keep a dedicated API key out of argv and pytest diagnostics."""

import argparse
import os
import stat
import subprocess
import sys
from pathlib import Path


def load_private_key(path: Path) -> str:
    try:
        with path.open("r", encoding="utf-8") as stream:
            metadata = os.fstat(stream.fileno())
            if (
                path.is_symlink()
                or not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid != os.getuid()
                or metadata.st_mode & 0o077
                or metadata.st_size > 4096
            ):
                raise ValueError("Key file must be owned by you and have mode 0600 or stricter")
            key = stream.read(4097).strip()
    except OSError:
        raise ValueError("Unable to read the private test-key file") from None
    if not key.startswith("rc-") or any(char.isspace() for char in key):
        raise ValueError("Key file must contain only a dedicated Token Factory rc-* key")
    return key


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        key = load_private_key(arguments.key_file)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    environment = {
        **os.environ,
        "RADEON_API_KEY": key,
        "RUN_RADEON_LIVE": "1",
        "PYTEST_ADDOPTS": "",
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
    }
    # Full traceback and captured output can include request bodies or credentials.
    result = subprocess.run(
        [
            sys.executable, "-m", "pytest", "-q", "tests/test_live.py",
            "--tb=no", "--no-header", "--show-capture=no", "--disable-warnings",
        ],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        check=False,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())