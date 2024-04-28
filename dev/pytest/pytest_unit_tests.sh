#!/bin/bash
set -x

# libs
coverage run -m pytest -a api/tests/unit_tests
