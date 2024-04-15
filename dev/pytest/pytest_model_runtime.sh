#!/bin/bash
set -x

pytest api/tests/integration_tests/model_runtime/anthropic \
  api/tests/integration_tests/model_runtime/azure_openai \
  api/tests/integration_tests/model_runtime/openai api/tests/integration_tests/model_runtime/chatglm \
  api/tests/integration_tests/model_runtime/google api/tests/integration_tests/model_runtime/xinference \
  api/tests/integration_tests/model_runtime/huggingface_hub/test_llm.py
