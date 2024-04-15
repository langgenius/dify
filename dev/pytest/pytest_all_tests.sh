#!/bin/bash
set -x

# ModelRuntime
sh dev/pytest/pytest_model_runtime.sh

# Tools
sh dev/pytest/pytest_tools.sh

# Workflow
sh dev/pytest/pytest_workflow.sh
