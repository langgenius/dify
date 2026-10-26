"""
Test utilities for code executor integration tests.

This module provides lazy import functions to avoid module loading issues
that occur when modules are imported before the flask_app_with_containers fixture
has set up the proper environment variables and configuration.
"""

import importlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass


def force_reload_code_executor():
    """
    Force reload the code_executor module to reinitialize code_execution_endpoint_url.

    This function should be called after setting up environment variables
    to ensure the code_execution_endpoint_url is initialized with the correct value.
    """
    try:
        import core.helper.code_executor.code_executor

        importlib.reload(core.helper.code_executor.code_executor)
    except Exception as e:
        # Log the error but don't fail the test
        print(f"Warning: Failed to reload code_executor module: {e}")


def get_code_executor_imports():
    """
    Lazy import function for core CodeExecutor classes.

    Returns:
        tuple: (CodeExecutor, CodeLanguage) classes
    """
    from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage

    return CodeExecutor, CodeLanguage


def get_javascript_imports():
    """
    Lazy import function for JavaScript-specific modules.

    Returns:
        tuple: (JavascriptCodeProvider, NodeJsTemplateTransformer) classes
    """
    from core.helper.code_executor.javascript.javascript_code_provider import JavascriptCodeProvider
    from core.helper.code_executor.javascript.javascript_transformer import NodeJsTemplateTransformer

    return JavascriptCodeProvider, NodeJsTemplateTransformer


def get_python3_imports():
    """
    Lazy import function for Python3-specific modules.

    Returns:
        tuple: (Python3CodeProvider, Python3TemplateTransformer) classes
    """
    from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider
    from core.helper.code_executor.python3.python3_transformer import Python3TemplateTransformer

    return Python3CodeProvider, Python3TemplateTransformer


def get_jinja2_imports():
    """
    Lazy import function for Jinja2-specific modules.

    Returns:
        tuple: (None, Jinja2TemplateTransformer) classes
    """
    from core.helper.code_executor.jinja2.jinja2_transformer import Jinja2TemplateTransformer

    return None, Jinja2TemplateTransformer


class CodeExecutorTestMixin:
    """
    Mixin class providing lazy import methods for code executor tests.

    This mixin helps avoid module loading issues by deferring imports
    until after the flask_app_with_containers fixture has set up the environment.
    """

    def setup_method(self):
        """
        Setup method called before each test method.
        Force reload the code_executor module to ensure fresh initialization.
        """
        force_reload_code_executor()

    @property
    def code_executor_imports(self):
        """Property to get CodeExecutor and CodeLanguage classes."""
        return get_code_executor_imports()

    @property
    def javascript_imports(self):
        """Property to get JavaScript-specific classes."""
        return get_javascript_imports()

    @property
    def python3_imports(self):
        """Property to get Python3-specific classes."""
        return get_python3_imports()

    @property
    def jinja2_imports(self):
        """Property to get Jinja2-specific classes."""
        return get_jinja2_imports()
