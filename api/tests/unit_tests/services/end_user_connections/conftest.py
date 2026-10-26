import pytest


@pytest.fixture(autouse=True)
def signed_connection_revisions(connection_revision_key: None) -> None:
    pass
