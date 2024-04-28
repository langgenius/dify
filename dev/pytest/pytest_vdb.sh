#!/bin/bash
set -x

coverage run -a -m pytest api/tests/integration_tests/vdb/
