from core.helper.marketplace import download_plugin_pkg


def test_download_plugin_pkg():
    pkg = download_plugin_pkg("yeuoly/google:0.0.1@4ff79ee644987e5b744d9c5b7a735d459fe66f26b28724326a7834d7e459e708")
    assert pkg is not None
    assert len(pkg) > 0
