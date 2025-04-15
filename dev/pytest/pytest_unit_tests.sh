#!/bin/bash
set -x

# libs
pytest --cov=./api --cov-report=json api/tests/unit_tests
