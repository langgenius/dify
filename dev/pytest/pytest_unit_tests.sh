#!/bin/bash
set -x

# libs
coverage run -a -m pytest api/tests/unit_tests
