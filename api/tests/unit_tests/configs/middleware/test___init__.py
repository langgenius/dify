import pytest
from sqlalchemy.engine import make_url

from configs.middleware import DatabaseConfig


@pytest.mark.parametrize("database_type", ["postgresql", "mysql", "oceanbase", "seekdb"])
@pytest.mark.parametrize("credential", ["word with spaces", "a+b /@:%?#", "plain"])
def test_database_url_preserves_credentials(database_type: str, credential: str) -> None:
    """Configured credentials round-trip through the SQLAlchemy URL parser used by the engine."""
    config = DatabaseConfig.model_validate(
        {
            "DB_TYPE": database_type,
            "DB_USERNAME": credential,
            "DB_PASSWORD": credential,
            "DB_HOST": "localhost",
            "DB_PORT": 5432,
            "DB_DATABASE": "dify",
        }
    )

    parsed = make_url(config.SQLALCHEMY_DATABASE_URI)

    assert parsed.username == credential
    assert parsed.password == credential


@pytest.mark.parametrize("database_type", ["postgresql", "mysql"])
@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "2001:db8::10", "[2001:db8::10]"])
def test_database_url_preserves_host_and_port(database_type: str, host: str) -> None:
    """Hostname and IPv6 settings reach SQLAlchemy as a host and a separate port."""
    config = DatabaseConfig.model_validate({"DB_TYPE": database_type, "DB_HOST": host, "DB_PORT": 5433})

    parsed = make_url(config.SQLALCHEMY_DATABASE_URI)

    assert parsed.host == host.strip("[]")
    assert parsed.port == 5433
