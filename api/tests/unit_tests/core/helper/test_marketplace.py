from core.helper.marketplace import download_plugin_pkg


def test_download_plugin_pkg():
    pkg = download_plugin_pkg("langgenius/bing:0.0.1@e58735424d2104f208c2bd683c5142e0332045b425927067acf432b26f3d970b")
    assert pkg is not None
    assert len(pkg) > 0
