from core.sandbox.services.asset_download_service import AssetDownloadItem, AssetDownloadService


def test_build_download_script_includes_downloader_detection() -> None:
    script = AssetDownloadService.build_download_script([], "skills")

    assert "command -v curl" in script
    assert "command -v wget" in script
    assert "command -v python3" in script
    assert "No downloader found" in script


def test_build_download_script_contains_items_and_root() -> None:
    items = [
        AssetDownloadItem(path="/docs/readme.md", url="https://example.com/readme.md"),
        AssetDownloadItem(path="/data/input.json", url="https://example.com/input.json"),
    ]

    script = AssetDownloadService.build_download_script(items, "skills")

    assert "download_root=skills" in script
    assert "/docs/readme.md" in script
    assert "https://example.com/readme.md" in script
    assert "/data/input.json" in script
    assert "https://example.com/input.json" in script


def test_build_download_script_escapes_paths_and_urls() -> None:
    items = [
        AssetDownloadItem(path='/space path/"quoted".txt', url="https://example.com/a?b=1&c=2"),
        AssetDownloadItem(path=r"/path/with\\backslash", url="https://example.com/with space"),
    ]

    script = AssetDownloadService.build_download_script(items, "skills")

    assert "'" in script
    assert "\\\\" in script
    assert "?b=1&c=2" in script


def test_build_download_script_runs_parallel_jobs() -> None:
    script = AssetDownloadService.build_download_script([], "skills")

    assert "download_one" in script
    assert "&" in script
    assert "wait" in script


def test_build_download_script_appends_failures() -> None:
    script = AssetDownloadService.build_download_script([], "skills")

    assert "fail_log" in script
    assert "Failed downloads" in script


def test_build_download_script_contains_python_fallback() -> None:
    script = AssetDownloadService.build_download_script([], "skills")

    assert "python3 -" in script
    assert "urllib.request" in script
