# -*- coding:utf-8 -*-

import pytest
import flask_migrate

from app import create_app
from extensions.ext_database import db


@pytest.fixture(scope='module')
def test_client():
    # Create a Flask app configured for testing
    from config import TestConfig
    flask_app = create_app(TestConfig())
    flask_app.config.from_object('config.TestingConfig')

    # Create a test client using the Flask application configured for testing
    with flask_app.test_client() as testing_client:
        # Establish an application context
        with flask_app.app_context():
            yield testing_client  # this is where the testing happens!


@pytest.fixture(scope='module')
def init_database(test_client):
    # Initialize the database
    with test_client.application.app_context():
        flask_migrate.upgrade()

    yield  # this is where the testing happens!

    # Clean up the database
    with test_client.application.app_context():
        flask_migrate.downgrade()


@pytest.fixture(scope='module')
def db_session(test_client):
    with test_client.application.app_context():
        yield db.session


@pytest.fixture(scope='function')
def login_default_user(test_client):

    # todo
    
    yield  # this is where the testing happens!

    test_client.get('/logout', follow_redirects=True)