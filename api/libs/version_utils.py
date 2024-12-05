import sys


def check_supported_python_version():
    python_version = sys.version_info
    if not ((3, 11) <= python_version < (3, 13)):
        print(
            "Aborted to launch the service "
            f" with unsupported Python version {python_version.major}.{python_version.minor}."
            " Please ensure Python 3.11 or 3.12."
        )
        raise SystemExit(1)
