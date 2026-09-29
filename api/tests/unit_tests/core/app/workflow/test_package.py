import subprocess
import sys
from pathlib import Path


def test_workflow_package_defers_node_factory_and_preserves_its_export() -> None:
    """Use a fresh interpreter so collection's imports cannot hide eager loading."""
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys\n"
            "import core.app.workflow as workflow\n"
            "assert 'core.workflow.node_factory' not in sys.modules\n"
            "from core.app.workflow import DifyNodeFactory\n"
            "from core.workflow.node_factory import DifyNodeFactory as factory\n"
            "assert DifyNodeFactory is factory\n"
            "assert workflow.DifyNodeFactory is factory\n"
            "assert not hasattr(workflow, 'missing_export')\n",
        ],
        cwd=Path(__file__).resolve().parents[5],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stderr
