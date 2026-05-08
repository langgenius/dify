"""Generate FastOpenAPI OpenAPI 3.0 specs without booting the full backend."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import dataclass
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from dev.generate_swagger_specs import apply_runtime_defaults, drop_null_values, sort_openapi_arrays

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FastOpenApiSpecTarget:
    route: str
    filename: str


FASTOPENAPI_SPEC_TARGETS: tuple[FastOpenApiSpecTarget, ...] = (
    FastOpenApiSpecTarget(route="/fastopenapi/openapi.json", filename="fastopenapi-console-openapi.json"),
)


def create_fastopenapi_spec_app():
    """Build a minimal Flask app that only mounts FastOpenAPI docs routes."""

    apply_runtime_defaults()

    from app_factory import create_flask_app_with_configs
    from extensions import ext_fastopenapi

    app = create_flask_app_with_configs()
    ext_fastopenapi.init_app(app)
    return app


def generate_fastopenapi_specs(output_dir: Path) -> list[Path]:
    """Write FastOpenAPI specs to `output_dir` and return the written paths."""

    output_dir.mkdir(parents=True, exist_ok=True)

    app = create_fastopenapi_spec_app()
    client = app.test_client()

    written_paths: list[Path] = []
    for target in FASTOPENAPI_SPEC_TARGETS:
        response = client.get(target.route)
        if response.status_code != 200:
            raise RuntimeError(f"failed to fetch {target.route}: {response.status_code}")

        payload = response.get_json()
        if not isinstance(payload, dict):
            raise RuntimeError(f"unexpected response payload for {target.route}")
        payload = drop_null_values(payload)
        payload = sort_openapi_arrays(payload)

        output_path = output_dir / target.filename
        output_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        written_paths.append(output_path)

    return written_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=Path("openapi"),
        help="Directory where the OpenAPI JSON files will be written.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    written_paths = generate_fastopenapi_specs(args.output_dir)

    for path in written_paths:
        logger.debug(path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
