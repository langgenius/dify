from flask import Flask

from libs.url_utils import get_request_base_url


def test_get_request_base_url_prefers_origin_with_non_standard_port():
    app = Flask(__name__)
    with app.test_request_context(
        "/console/api/apps",
        base_url="http://192.168.113.55/",
        headers={"Origin": "http://192.168.113.55:8080"},
    ):
        assert get_request_base_url() == "http://192.168.113.55:8080"


def test_get_request_base_url_uses_referer_when_origin_missing():
    app = Flask(__name__)
    with app.test_request_context(
        "/console/api/apps",
        base_url="http://192.168.113.55/",
        headers={"Referer": "http://192.168.113.55:8080/app/abc/overview"},
    ):
        assert get_request_base_url() == "http://192.168.113.55:8080"


def test_get_request_base_url_falls_back_to_url_root():
    app = Flask(__name__)
    with app.test_request_context("/console/api/apps", base_url="http://example.com:9000/"):
        assert get_request_base_url() == "http://example.com:9000"
