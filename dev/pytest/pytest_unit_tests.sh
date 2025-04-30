#!/bin/bash
set -x

# libs
cd api
pytest tests/unit_tests
