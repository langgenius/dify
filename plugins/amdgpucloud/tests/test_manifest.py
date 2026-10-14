import tomllib
from pathlib import Path
from urllib.parse import urlsplit

import yaml

from scripts.check_package import valid_plugin_identity

ROOT = Path(__file__).resolve().parents[1]


def test_manifest_and_provider_contract() -> None:
    manifest = yaml.safe_load((ROOT / "manifest.yaml").read_text())
    provider = yaml.safe_load((ROOT / "provider" / "amdgpucloud.yaml").read_text())

    assert manifest["name"] == "amdgpucloud"
    assert manifest["label"] == {"en_US": "AMDGPUCloud", "zh_Hans": "AMDGPUCloud"}
    assert manifest["author"] == "amdgpucloud"
    assert manifest["version"] == "0.0.9"
    assert manifest["meta"]["version"] == "0.0.2"
    assert manifest["meta"]["minimum_dify_version"] == "1.17.1"
    assert manifest["plugins"]["models"] == ["provider/amdgpucloud.yaml"]
    assert manifest["network"]["domains"] == ["developer.amd.com.cn"]
    assert provider["provider"] == "amdgpucloud"
    assert f'{manifest["author"]}/{manifest["name"]}' == "amdgpucloud/amdgpucloud"
    assert provider["label"] == manifest["label"]
    assert provider["configurate_methods"] == ["predefined-model"]
    credentials = provider["provider_credential_schema"]["credential_form_schemas"]
    assert [field["variable"] for field in credentials] == ["api_key"]
    assert credentials[0]["type"] == "secret-input"
    assert credentials[0]["required"] is True


def test_get_key_help_matches_cherry_service_without_borrowing_its_source() -> None:
    provider = yaml.safe_load((ROOT / "provider" / "amdgpucloud.yaml").read_text())
    for url in provider["help"]["url"].values():
        assert url == "https://developer.amd.com.cn/radeon/modelapis"
        assert urlsplit(url).query == ""


def test_brand_icon_is_local_and_shared_by_the_native_provider() -> None:
    manifest = yaml.safe_load((ROOT / "manifest.yaml").read_text())
    provider = yaml.safe_load((ROOT / "provider" / "amdgpucloud.yaml").read_text())
    assert manifest["icon"] == "icon.png"
    icon = (ROOT / "_assets" / manifest["icon"]).read_bytes()
    assert icon[:8] == b"\x89PNG\r\n\x1a\n"
    assert int.from_bytes(icon[16:20], "big") == 256
    assert int.from_bytes(icon[20:24], "big") == 256
    for size in ("icon_small", "icon_large"):
        assert set(provider[size].values()) == {"icon.png"}


def test_referenced_files_exist() -> None:
    provider = yaml.safe_load((ROOT / "provider" / "amdgpucloud.yaml").read_text())
    assert (ROOT / provider["extra"]["python"]["provider_source"]).is_file()
    for source in provider["extra"]["python"]["model_sources"]:
        assert (ROOT / source).is_file()


def test_manifest_identity_matches_native_daemon_grammar() -> None:
    manifest = yaml.safe_load((ROOT / "manifest.yaml").read_text())
    assert valid_plugin_identity(manifest)


def test_native_identifier_rejects_mixed_case_author() -> None:
    assert not valid_plugin_identity(
        {"author": "Letian-Kang", "name": "amdgpucloud", "version": "0.0.8"}
    )
    assert valid_plugin_identity(
        {"author": "letian-kang", "name": "amdgpucloud", "version": "0.0.8"}
    )


def test_personal_publisher_uses_hyphen_not_unsupported_dot() -> None:
    assert not valid_plugin_identity(
        {"author": "letian.kang", "name": "amdgpucloud", "version": "0.0.8"}
    )
    assert valid_plugin_identity(
        {"author": "letian-kang", "name": "amdgpucloud", "version": "0.0.8"}
    )


def test_human_author_and_contact_are_consistent_without_breaking_identity() -> None:
    manifest = yaml.safe_load((ROOT / "manifest.yaml").read_text())
    provider = yaml.safe_load((ROOT / "provider/amdgpucloud.yaml").read_text())
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]
    assert manifest["author"] == "amdgpucloud"
    assert manifest["name"] == provider["provider"] == "amdgpucloud"
    assert project["name"] == "dify-plugin-amdgpucloud"
    assert valid_plugin_identity(manifest)
    assert manifest["contact"] == "Letian.Kang@amd.com"
    assert project["authors"] == [{"name": "Letian Kang", "email": "Letian.Kang@amd.com"}]
    assert project["version"] == manifest["version"]
    for declaration in (manifest, provider):
        assert all(
            "Letian Kang" in text and "Letian.Kang@amd.com" in text
            for text in declaration["description"].values()
        )
    for relative in (
        "README.md", "PRIVACY.md", "readme/README_zh_Hans.md",
        "readme/INSTALL_windows_zh_Hans.txt",
    ):
        text = (ROOT / relative).read_text()
        assert "Letian Kang" in text and "Letian.Kang@amd.com" in text
        assert "kangletian@hotmail.com" not in text


def test_packaged_windows_guide_documents_required_overlay_and_native_setup() -> None:
    guide = (ROOT / "readme/INSTALL_windows_zh_Hans.txt").read_text()
    assert "API 兼容层" in guide
    assert "api-compat/" in guide
    assert "Self-hosted API compatibility" in guide
    assert "windows-installer/" not in guide
    assert "从本地文件" in guide
    assert "amdgpucloud/amdgpucloud" in guide


def test_release_declarations_never_use_the_previous_machine_identity() -> None:
    for relative in ("manifest.yaml", "provider/amdgpucloud.yaml", "pyproject.toml"):
        content = (ROOT / relative).read_text()
        assert "radeon_cloud" not in content
        assert "joursbleu" not in content
    assert not (ROOT / "provider/radeon_cloud.yaml").exists()
    assert not (ROOT / "provider/radeon_cloud.py").exists()


def test_remote_catalog_does_not_embed_model_ids_or_fallback_yaml() -> None:
    provider = yaml.safe_load((ROOT / "provider/amdgpucloud.yaml").read_text())
    assert provider["models"]["llm"]["predefined"] == []
    assert not list((ROOT / "models/llm").glob("*.yaml"))
    assert "VALIDATION_MODEL" not in (ROOT / "models/_credentials.py").read_text()