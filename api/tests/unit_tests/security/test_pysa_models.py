import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

EXPECTED_POSITIVE_RULES = {
    "positive_rce": 5001,
    "positive_external_rce": 5001,
    "positive_sql": 5005,
    "positive_xss": 5008,
    "positive_filesystem": 5011,
    "positive_http": 5012,
    "positive_redirect": 5018,
    "positive_import": 6064,
    "positive_command": 6065,
    "positive_deserialize": 6066,
    "positive_template": 6073,
}


def test_pysa_rules_detect_positive_flows_only(tmp_path: Path) -> None:
    api_root = Path(__file__).parents[3]
    pysa_root = api_root / "security" / "pysa"
    model_root = tmp_path / "models"
    model_root.mkdir()
    shutil.copyfile(pysa_root / "taint.config", model_root / "taint.config")
    shutil.copyfile(pysa_root / "tests" / "fixture.pysa.in", model_root / "fixture.pysa")

    environment = os.environ.copy()
    environment["PYREFLY_CONFIG"] = str(pysa_root / "tests" / "pyrefly.toml")
    result = subprocess.run(
        [
            str(Path(sys.executable).parent / "pyre"),
            "analyze",
            "--taint-models-path",
            str(model_root),
        ],
        cwd=api_root,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    issues = json.loads(result.stdout)
    actual = {(issue["define"].rsplit(".", 1)[-1], issue["code"]) for issue in issues}
    expected = set(EXPECTED_POSITIVE_RULES.items())
    assert expected <= actual
    assert not any(name.startswith("negative_") for name, _ in actual)
