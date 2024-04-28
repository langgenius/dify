#!/bin/bash
set -x

# libs
coverage run -m pytest api/tests/unit_tests
