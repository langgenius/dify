"""Export community Console schemas to stdout for the OpenAPI content mapper."""

import contextlib
import json
import sys
from pathlib import Path


def main() -> None:
    # Backend initialization may log to stdout. Keep the protocol output pure JSON.
    with contextlib.redirect_stdout(sys.stderr):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from dev.generate_fastopenapi_specs import export_fastopenapi_specs
        from dev.generate_swagger_specs import export_specs

        documents = {
            "console": export_specs()["console-openapi.json"],
            "fast": export_fastopenapi_specs()["fastopenapi-console-openapi.json"],
        }
    json.dump(documents, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
