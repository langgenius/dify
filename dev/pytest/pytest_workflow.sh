#!/bin/bash
set -x

coverage run -m pytest -a api/tests/integration_tests/workflow
