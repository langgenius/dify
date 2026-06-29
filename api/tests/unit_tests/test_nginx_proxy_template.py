from pathlib import Path


def test_nginx_proxy_preserves_original_host_header_port():
    repo_root = Path(__file__).resolve().parents[3]
    proxy_template = repo_root / "docker" / "nginx" / "proxy.conf.template"

    config = proxy_template.read_text()

    assert "proxy_set_header Host $http_host;" in config
    assert "proxy_set_header Host $host;" not in config
