from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def test_schema_definitions_endpoint_uses_admission_and_builtin_registry(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _ = create_console_account_and_tenant(db_session_with_containers)
    headers = authenticate_console_client(test_client_with_containers, account)

    response = test_client_with_containers.get(
        "/console/api/spec/schema-definitions",
        headers=headers,
    )

    assert response.status_code == 200
    definitions = response.get_json()
    assert isinstance(definitions, list)
    assert definitions
    assert all({"name", "label", "schema"} <= definition.keys() for definition in definitions)


def test_schema_definitions_endpoint_rejects_unauthenticated_request(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    create_console_account_and_tenant(db_session_with_containers)

    response = test_client_with_containers.get("/console/api/spec/schema-definitions")

    assert response.status_code == 401
