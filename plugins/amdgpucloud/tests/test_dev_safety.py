import zipfile
from pathlib import Path

import pytest
import yaml

from scripts.check_package import inspect_package
from scripts.run_live_tests import load_private_key


def test_live_launcher_requires_private_owned_regular_key_file(tmp_path: Path) -> None:
    path = tmp_path / "test-key"
    path.write_text("rc-offline-fixture")
    path.chmod(0o600)
    assert load_private_key(path) == "rc-offline-fixture"
    path.chmod(0o644)
    with pytest.raises(ValueError, match="0600"):
        load_private_key(path)
    path.chmod(0o600)
    link = tmp_path / "link"
    link.symlink_to(path)
    with pytest.raises(ValueError, match="0600"):
        load_private_key(link)


def test_package_audit_rejects_environment_traversal_and_credential_literals(tmp_path) -> None:
    package = tmp_path / "unsafe.difypkg"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr(".env", "not-a-secret")
        archive.writestr(".venv-dev/file", "not-a-secret")
        archive.writestr("../escape", "not-a-secret")
        archive.writestr("literal.py", "rc-" + "x" * 48)
    failures = inspect_package(package)
    assert any(".env" in failure for failure in failures)
    assert any(".venv-dev" in failure for failure in failures)
    assert any("../escape" in failure for failure in failures)
    assert any("Possible credential literal" in failure for failure in failures)


@pytest.mark.parametrize(
    "relative", ["provider/amdgpucloud.yaml", "readme/INSTALL_windows_zh_Hans.txt"]
)
def test_package_audit_rejects_missing_human_author_and_contact(
    tmp_path: Path, relative: str
) -> None:
    root = Path(__file__).resolve().parents[1]
    package = tmp_path / "missing-attribution.difypkg"
    with zipfile.ZipFile(package, "w") as archive:
        for name in (
            "manifest.yaml", "provider/amdgpucloud.yaml", "models/llm/llm.py",
            "models/_transport.py", "PRIVACY.md", "README.md", "readme/README_zh_Hans.md",
            "readme/INSTALL_windows_zh_Hans.txt",
        ):
            text = (root / name).read_text()
            if name == relative:
                text = text.replace("Letian Kang", "Previous maintainer").replace(
                    "Letian.Kang@amd.com", "kangletian@hotmail.com"
                )
            archive.writestr(name, text)
    failures = inspect_package(package)
    assert any(f"Missing human author/contact in: {relative}" == failure for failure in failures)


@pytest.mark.parametrize("field", ["author", "name"])
def test_package_audit_rejects_display_only_rename_with_old_identity(tmp_path, field) -> None:
    root = Path(__file__).resolve().parents[1]
    manifest = yaml.safe_load((root / "manifest.yaml").read_text())
    manifest[field] = "joursbleu" if field == "author" else "radeon_cloud"
    package = tmp_path / "old-identity.difypkg"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("manifest.yaml", yaml.safe_dump(manifest))
    assert "Manifest must use the amdgpucloud/amdgpucloud identity" in inspect_package(package)


def test_compatibility_package_audit_rejects_unrequested_publisher_migration(tmp_path) -> None:
    root = Path(__file__).resolve().parents[1]
    manifest = yaml.safe_load((root / "manifest.yaml").read_text())
    manifest["author"] = "letian-kang"
    package = tmp_path / "brand-publisher.difypkg"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("manifest.yaml", yaml.safe_dump(manifest))
    assert "Manifest must use the amdgpucloud/amdgpucloud identity" in inspect_package(package)