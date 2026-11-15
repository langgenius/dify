"""Export a committed, additive Agent dev overlay without copying a full checkout.

The deployed a69 revision must be an ancestor of the source revision. Only
changed API files and the managed Graphon source enter the build context.
Deletes, uncommitted source, symlinks and an existing destination are rejected.
No checkout, branch, remote service, dependency, or deployment is modified.
"""

import argparse
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path

BASE_REVISION = "a69a8fa067c8f476bf5f507ba47c390e0b02daf7"
TOOLING = "docker/byoa-agent-dev-integration"


def git(repository: Path, *arguments: str) -> bytes:
    """Read a Git object or diff; fail before exporting on any Git error."""
    return subprocess.check_output(["git", "-C", str(repository), *arguments])


def prepare(repository: Path, source: str, destination: Path) -> dict[str, object]:
    """Create a new source-only context from the committed integration revision."""
    source = git(repository, "rev-parse", f"{source}^{{commit}}").decode().strip()
    ancestor = git(repository, "merge-base", BASE_REVISION, source).decode().strip()
    if ancestor != BASE_REVISION:
        raise ValueError("Source must preserve the deployed a69 history")
    paths = ("api", "packages/graphon", TOOLING)
    dirty = git(repository, "diff", source, "--", *paths)
    untracked = git(
        repository, "ls-files", "--others", "--exclude-standard", "--", *paths
    )
    if dirty or untracked:
        raise ValueError("Commit all overlay source before exporting it")
    deleted = git(
        repository,
        "diff",
        "--name-only",
        "--diff-filter=D",
        BASE_REVISION,
        source,
        "--",
        *paths,
    )
    if deleted:
        raise ValueError("API source deletion needs a separately reviewed deployment")
    modified = (
        git(
            repository,
            "diff",
            "--name-only",
            "--diff-filter=AM",
            BASE_REVISION,
            source,
            "--",
            "api",
            "packages/graphon",
        )
        .decode()
        .splitlines()
    )
    changed = [
        name
        for name in modified
        if "/tests/" not in name
        and not any(
            part.startswith(".env") or part.endswith(".env")
            for part in Path(name).parts
        )
        and not any(
            part in {".venv", "__pycache__", ".cache", "storage"}
            for part in Path(name).parts
        )
        and not name.endswith(".log")
        and ".log." not in name
    ]
    if "api/docker/entrypoint.sh" not in changed:
        raise ValueError("The dedicated worker entrypoint must be part of the overlay")
    if destination.exists():
        raise ValueError(
            "Destination must be new; no previous build context is overwritten"
        )
    destination.mkdir(parents=True)
    content = git(repository, "archive", "--format=tar", source, "--", *changed)
    receipts = []
    with tarfile.open(fileobj=io.BytesIO(content)) as archive:
        for member in archive:
            relative = Path(member.name)
            if (
                relative.is_absolute()
                or ".." in relative.parts
                or member.issym()
                or member.islnk()
            ):
                raise ValueError(
                    "Only owned regular source files may enter the overlay"
                )
            if member.isfile():
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError("Source member has no content")
                payload = stream.read()
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
                target.chmod(member.mode & 0o777)
                receipts.append(
                    {"path": member.name, "sha256": hashlib.sha256(payload).hexdigest()}
                )
    for source_name, context_name in (
        ("Dockerfile", "Dockerfile"),
        ("Dockerfile.dockerignore", "Dockerfile.dockerignore"),
        ("validate_environment.py", "validate_environment.py"),
    ):
        (destination / context_name).write_bytes(
            git(repository, "show", f"{source}:{TOOLING}/{source_name}")
        )
    manifest = {
        "base_revision": BASE_REVISION,
        "source_revision": source,
        "files": receipts,
    }
    (destination / "overlay-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    return {
        "context": str(destination),
        "source_revision": source,
        "source_files": len(receipts),
    }


def main() -> None:
    """Require an explicit repository, committed revision, and new destination."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True, type=Path)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    print(
        json.dumps(
            prepare(
                arguments.repository.resolve(),
                arguments.source_revision,
                arguments.output.resolve(),
            )
        )
    )


if __name__ == "__main__":
    main()
