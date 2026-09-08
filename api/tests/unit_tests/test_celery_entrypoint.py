import runpy
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest


@pytest.mark.parametrize("gevent_pool", [False, True])
def test_entrypoint_only_patches_libraries_for_a_gevent_pool(gevent_pool: bool) -> None:
    fake_app = SimpleNamespace(app=object(), celery=object())
    with (
        patch.dict(sys.modules, {"app": fake_app}),
        patch("gevent.monkey.is_module_patched", return_value=gevent_pool),
        patch("grpc.experimental.gevent.init_gevent") as patch_grpc,
        patch("psycogreen.gevent.patch_psycopg") as patch_psycopg,
    ):
        runpy.run_path(str(Path(__file__).parents[2] / "celery_entrypoint.py"))
    assert patch_grpc.call_count == int(gevent_pool)
    assert patch_psycopg.call_count == int(gevent_pool)
