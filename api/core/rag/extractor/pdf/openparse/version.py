OPEN_PARSE_VERSION = "0.5.2"


def version_info() -> str:
    """Return complete version information for OpenParse and its dependencies."""
    import importlib.metadata as importlib_metadata
    import platform
    import sys
    from pathlib import Path

    python_version = sys.version.split()[0]
    operating_system = platform.system()
    os_version = platform.release()

    package_names = {
        "email-validator",
        "torch",
        "torchvision",
        "transformers",
        "tokenizers",
        "PyMuPDF",
        "pydantic",
    }
    related_packages = []

    for dist in importlib_metadata.distributions():
        name = dist.metadata["Name"]
        if name in package_names:
            related_packages.append(f"{name}-{dist.version}")

    info = {
        "python_version": python_version,
        "operating_system": operating_system,
        "os_version": os_version,
        "open-parse version": OPEN_PARSE_VERSION,
        "install path": Path(__file__).resolve().parent,
        "python version": sys.version,
        "platform": platform.platform(),
        "related packages": " ".join(related_packages),
    }
    return "\n".join(
        "{:>30} {}".format(k + ":", str(v).replace("\n", " ")) for k, v in info.items()
    )
