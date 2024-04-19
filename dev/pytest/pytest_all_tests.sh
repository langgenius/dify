#!/bin/bash
set -x

# ModelRuntime
dev/pytest/pytest_model_runtime.sh

# Tools
dev/pytest/pytest_tools.sh

# Workflow
dev/pytest/pytest_workflow.sh
