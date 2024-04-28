#!/bin/bash
set -x

coverage run -a -m  pytest api/tests/integration_tests/tools/test_all_provider.py
