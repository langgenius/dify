#!/bin/bash
export PYTHONPATH=$PYTHONPATH:/app
pytest -p no:cov api/tests/unit/test_webhook_controller.py
