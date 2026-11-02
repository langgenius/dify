from collections.abc import Iterator

import pytest
from sqlalchemy.orm import Session

from app_factory import create_flask_app_with_configs
from dify_app import DifyApp
from extensions import ext_database
from extensions.ext_database import db


@pytest.fixture(scope="session")
def mysql_app() -> DifyApp:
    app = create_flask_app_with_configs()
    ext_database.init_app(app)
    return app


@pytest.fixture
def mysql_session(mysql_app: DifyApp) -> Iterator[Session]:
    with mysql_app.app_context():
        with Session(bind=db.engine, expire_on_commit=False) as session:
            assert session.get_bind().dialect.name == "mysql"
            try:
                yield session
            finally:
                session.rollback()
