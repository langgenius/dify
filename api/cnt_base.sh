#!/bin/bash
set -euxo pipefail

printf "This file is gen by cnt_base.sh\n" > ./stat.txt
printf "Base " >> ./stat.txt
grep "(Base):" -r --exclude-dir=".venv" --exclude-dir="tests" . | wc -l >> ./stat.txt
printf "TypeBase " >> ./stat.txt
grep "(TypeBase):" -r --exclude-dir=".venv" --exclude-dir="tests" . | wc -l >> ./stat.txt
