"""Shared helpers for FastAPI/API v2 tests."""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response


def apptest_get(app: FastAPI, path: str) -> Response:
    return TestClient(app).get(path)
