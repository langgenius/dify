# -*- coding:utf-8 -*-

import pytest

from app import create_app

def test_create_app():

    # Test Default(CE) Config
    app = create_app()
    
    assert app.config['SECRET_KEY'] is not None
    assert app.config['SQLALCHEMY_DATABASE_URI'] is not None
    assert app.config['EDITION'] == "SELF_HOSTED"

    # Test TestConfig
    from config import TestConfig
    test_app = create_app(TestConfig())

    assert test_app.config['SECRET_KEY'] is not None
    assert test_app.config['SQLALCHEMY_DATABASE_URI'] is not None
    assert test_app.config['TESTING'] is True