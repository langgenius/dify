# API unit test sharding

Run the selector from the repository root. Without `--durations`, it assigns
sorted files round-robin. With `--durations`, it assigns the slowest files first
to the shard with the lowest estimated total duration. Paths break ties, making
assignment deterministic across runners. Pytest still discovers every current
test file; the timing data is not an allowlist. Unmeasured files use the median
recorded duration and deleted files are not selected.

`pytest_file_durations.json` contains summed JUnit testcase times (setup, call,
and teardown across both workers), in seconds. The initial snapshot comes from
GitHub Actions run 35504653636, commit 353da439c8. It excludes controller tests,
which run in their own job. These numbers estimate relative work, not shard wall
time or import costs. Refresh when observed shard runtimes drift apart; updates
do not need to accompany every new test.

To refresh, download all `api-test-results-unit-*` artifacts from one successful
CI run into `/tmp/api-unit-reports`, then run this from the repository root:

```sh
uv run --project api python - <<'PY'
import json
from collections import defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET

seconds = defaultdict(float)
reports = list(Path('/tmp/api-unit-reports').glob('api-test-results-unit-*/unit.xml'))
assert reports, 'No unit reports found'
for report in reports:
    tree = ET.parse(report)
    assert not list(tree.iter('failure')) and not list(tree.iter('error'))
    for case in tree.iter('testcase'):
        parts = case.attrib['classname'].split('.')
        for index, part in enumerate(parts):
            if part.startswith('test_') or part.endswith('_test'):
                path = Path('api', *parts[:index + 1]).with_suffix('.py')
                assert path.is_file(), path
                seconds[path.as_posix()] += float(case.get('time', '0'))
                break
        else:
            raise ValueError(case.attrib['classname'])
Path('api/dev/pytest_file_durations.json').write_text(
    json.dumps({path: round(value, 3) for path, value in sorted(seconds.items())}, indent=2) + '\n'
)
PY
```

Use reports from a checkout matching the test paths and update the source run
above. Confirm that all unit shard artifacts were downloaded. Run the selector
tests and compare the full test case set and coverage in CI after changing the
assignment; changing which files share a process can expose test isolation bugs.
