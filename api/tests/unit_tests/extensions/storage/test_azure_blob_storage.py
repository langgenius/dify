"""Azure object absence permits provisioning; backend failures never imply absence."""

from unittest.mock import MagicMock

import pytest
from azure.core.exceptions import HttpResponseError, ResourceExistsError, ResourceNotFoundError, ServiceRequestError
from azure.core.pipeline.transport import HttpResponse

from extensions.storage.azure_blob_storage import AzureBlobStorage
from libs.credential_cipher import CredentialKeyUnavailableError
from libs.key_providers.deployment_local import LocalDeploymentKeyBackend


def _missing(code: str) -> ResourceNotFoundError:
    response = MagicMock(spec=HttpResponse)
    response.headers = {"x-ms-error-code": code}
    response.status_code = 404
    response.reason = code
    return ResourceNotFoundError("Missing Azure resource", response=response)


def test_first_deployment_key_is_created_and_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    stored: dict[str, bytes] = {}
    client = MagicMock()
    container = client.get_container_client.return_value

    def read() -> bytes:
        if "key" not in stored:
            raise _missing("BlobNotFound")
        return stored["key"]

    def upload(_filename: str, data: bytes, **_options: object) -> None:
        assert "key" not in stored
        stored["key"] = data

    container.get_blob_client.return_value.download_blob.return_value.readall.side_effect = read
    container.upload_blob.side_effect = upload
    storage = AzureBlobStorage()
    storage.bucket_name = "deployment-keys"
    monkeypatch.setattr(storage, "_sync_client", lambda: client)
    backend = LocalDeploymentKeyBackend(storage)

    reference = backend.provision("deployment", None)
    cipher = backend.bind("deployment", reference)
    assert cipher.decrypt(cipher.encrypt("credential")) == "credential"
    assert backend.provision("deployment", None) == reference
    assert backend.provision("deployment", reference) == reference
    assert container.upload_blob.call_count == 1


@pytest.mark.parametrize(
    "error",
    [
        _missing("ContainerNotFound"),
        _missing("UnknownResource"),
        HttpResponseError("Access denied", status_code=403),
        ServiceRequestError("Network unavailable"),
    ],
)
def test_storage_failure_never_creates_a_deployment_key(error: Exception, monkeypatch: pytest.MonkeyPatch) -> None:
    client = MagicMock()
    container = client.get_container_client.return_value
    container.get_blob_client.return_value.download_blob.side_effect = error
    storage = AzureBlobStorage()
    storage.bucket_name = "deployment-keys"
    monkeypatch.setattr(storage, "_sync_client", lambda: client)

    with pytest.raises(CredentialKeyUnavailableError):
        LocalDeploymentKeyBackend(storage).provision("deployment", None)
    container.upload_blob.assert_not_called()


def test_losing_atomic_creation_recovers_the_stored_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from Crypto.PublicKey import RSA

    encoded = RSA.generate(2048).export_key()
    response = MagicMock(spec=HttpResponse)
    response.headers = {"x-ms-error-code": "BlobAlreadyExists"}
    response.status_code = 409
    response.reason = "BlobAlreadyExists"
    exists = ResourceExistsError("Existing blob", response=response)
    client = MagicMock()
    container = client.get_container_client.return_value
    container.get_blob_client.return_value.download_blob.return_value.readall.side_effect = [
        _missing("BlobNotFound"),
        encoded,
        encoded,
    ]
    container.upload_blob.side_effect = exists
    storage = AzureBlobStorage()
    storage.bucket_name = "deployment-keys"
    monkeypatch.setattr(storage, "_sync_client", lambda: client)
    backend = LocalDeploymentKeyBackend(storage)

    reference = backend.provision("deployment", None)
    assert reference == RSA.import_key(encoded).publickey().export_key().decode("ascii")
    assert backend.bind("deployment", reference).encrypt("credential")
    container.upload_blob.assert_called_once()
    assert container.upload_blob.call_args.kwargs["overwrite"] is False
