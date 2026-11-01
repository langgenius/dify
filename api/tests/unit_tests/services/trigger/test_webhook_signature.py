import hashlib
import hmac

from services.trigger.webhook_service import WebhookService


def _node_config(secret):
    data = {
        "method": "post",
        "content_type": "application/json",
        "headers": [],
        "params": [],
        "body": [],
    }
    if secret is not None:
        data["signature_secret"] = secret
    return {"data": data}


def _signature(secret, body):
    return "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def test_no_secret_allows_any_call():
    assert WebhookService.verify_webhook_signature(_node_config(None), {}, b"{}") is True


def test_empty_secret_allows_any_call():
    assert WebhookService.verify_webhook_signature(_node_config(""), {}, b"{}") is True


def test_correct_signature_allowed():
    body = b'{"hello": "world"}'
    headers = {"X-Dify-Signature": _signature("s3cr3t", body)}
    assert WebhookService.verify_webhook_signature(_node_config("s3cr3t"), headers, body) is True


def test_header_name_case_insensitive():
    body = b"{}"
    headers = {"x-dify-signature": _signature("s3cr3t", body)}
    assert WebhookService.verify_webhook_signature(_node_config("s3cr3t"), headers, body) is True


def test_wrong_signature_rejected():
    body = b"{}"
    headers = {"X-Dify-Signature": _signature("other", body)}
    assert WebhookService.verify_webhook_signature(_node_config("s3cr3t"), headers, body) is False


def test_missing_signature_rejected():
    assert WebhookService.verify_webhook_signature(_node_config("s3cr3t"), {}, b"{}") is False


def test_malformed_signature_rejected():
    headers = {"X-Dify-Signature": "not-a-signature"}
    assert WebhookService.verify_webhook_signature(_node_config("s3cr3t"), headers, b"{}") is False


def test_signature_bound_to_body():
    body = b'{"a": 1}'
    headers = {"X-Dify-Signature": _signature("s3cr3t", b'{"a": 2}')}
    assert WebhookService.verify_webhook_signature(_node_config("s3cr3t"), headers, body) is False
