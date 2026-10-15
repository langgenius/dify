"""Fail the CI gate on missing, duplicate, failed or skipped native cases."""

import json
import sys
from pathlib import Path

EXPECTED = {
    "native-runtime-tests.jsonl": {
        "TestNativeScopeRealFilesystemSecretNetworkAndStdin",
        "TestNativeScopeRealBoundsAndTreeCancellation",
        "TestNativeScopeBrokerCanaryAndRawDenial",
        "TestNativeScopeOutputOverflowCannotReportSuccess",
    },
    "native-runtime-restart-prepare.jsonl": {"TestNativeScopeRestartPrepare"},
    "native-runtime-restart-resume.jsonl": {"TestNativeScopeRestartResume"},
}


def verify(directory: Path) -> None:
    for filename, expected in EXPECTED.items():
        passed = set()
        package_passes = 0
        for line in (directory / filename).read_text().splitlines():
            event = json.loads(line)
            action, test = event.get("Action"), event.get("Test")
            if action in {"fail", "skip"}:
                raise ValueError(f"{filename}: {action}: {test or 'package'}")
            if action != "pass":
                continue
            if not test:
                package_passes += 1
                continue
            if test.split("/", 1)[0] not in expected:
                raise ValueError(f"{filename}: unexpected test: {test}")
            if test in passed:
                raise ValueError(f"{filename}: duplicate test: {test}")
            passed.add(test)
        roots = {test for test in passed if "/" not in test}
        if roots != expected or package_passes != 1:
            raise ValueError(
                f"{filename}: expected {sorted(expected)}, got {sorted(roots)}; package passes={package_passes}"
            )
        sys.stdout.write(f"{filename}: {len(roots)} required cases passed; no failed/skipped/duplicate cases\n")


if __name__ == "__main__":
    verify(Path(sys.argv[1]))
