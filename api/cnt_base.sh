#!/bin/bash
set -euxo pipefail

for pattern in "Base" "TypeBase"; do
    printf "%s " "$pattern"
    grep "($pattern):" -r --include='*.py' --exclude-dir=".venv" --exclude-dir="tests" . | wc -l
done
