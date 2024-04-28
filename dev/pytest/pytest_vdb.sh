#!/bin/bash
set -x

coverage run -m pytest api/tests/integration_tests/vdb/
