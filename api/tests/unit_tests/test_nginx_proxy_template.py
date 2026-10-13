from pathlib import Path


def test_nginx_proxy_forwards_host_with_external_port() -> None:
    repository_root = Path(__file__).resolve().parents[3]
    proxy_template = repository_root / "docker" / "nginx" / "proxy.conf.template"

    assert "proxy_set_header Host $http_host;" in proxy_template.read_text()
