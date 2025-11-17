#!/bin/bash
set -euxo pipefail

printf "This file is gen by cnt_base.sh\n" > ./stat.txt
for pattern in "Base" "TypeBase"; do
    printf "%s " "$pattern" >> ./stat.txt
    grep "($pattern):" -r --exclude-dir=".venv" --exclude-dir="tests" . | wc -l >> ./stat.txt
done
