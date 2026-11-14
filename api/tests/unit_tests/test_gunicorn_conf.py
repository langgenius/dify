import pytest

from tests.helpers.unit.gc_probe import assert_startup_gc_behavior


@pytest.mark.parametrize("enabled", [True, False], ids=["enabled", "disabled"])
def test_worker_startup_freezes_only_startup_objects(enabled: bool) -> None:
    assert_startup_gc_behavior(
        "from gunicorn.config import Config\n"
        "config = Config()\n"
        "from runpy import run_path\n"
        'namespace = run_path("gunicorn.conf.py")\n'
        'if "post_worker_init" in namespace:\n'
        '    config.set("post_worker_init", namespace["post_worker_init"])\n'
        "def start():\n"
        "    config.post_worker_init(None)\n",
        enabled,
    )
