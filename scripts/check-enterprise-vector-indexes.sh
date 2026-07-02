#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/check-enterprise-vector-indexes.sh [--repair]

Checks that every high-quality dataset with completed/enabled segments has a
matching Weaviate class. By default this is read-only and exits non-zero when
missing classes are found.

Use --repair to rebuild missing Weaviate classes from existing Postgres
documents and segments. The repair path does not re-parse uploaded documents.

Environment:
  DIFY_ENTERPRISE_VERSION defaults to 1.15.0-enterprise
  COMPOSE_PROFILES defaults to weaviate,postgresql,collaboration
EOF
}

repair=false
for arg in "$@"; do
  case "$arg" in
    --repair)
      repair=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

export DIFY_ENTERPRISE_VERSION="${DIFY_ENTERPRISE_VERSION:-1.15.0-enterprise}"
export COMPOSE_PROFILES="${COMPOSE_PROFILES:-weaviate,postgresql,collaboration}"

compose_files=(-f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml)
python_repair="False"
if [[ "$repair" == true ]]; then
  python_repair="True"
fi

docker compose "${compose_files[@]}" exec -T api python - "$python_repair" <<'PY'
import json
import sys
import time
from dataclasses import dataclass

import httpx
from sqlalchemy import func, select

from app import flask_app as app
from extensions.ext_database import db
from models.dataset import Dataset, Document as DatasetDocument, DocumentSegment
from models.enums import IndexingStatus, SegmentStatus
from tasks.add_document_to_index_task import add_document_to_index_task


@dataclass
class DatasetIndexStatus:
    dataset_id: str
    name: str
    class_name: str
    segments: int
    documents: list[str]
    exists: bool
    status_code: int


def collection_name_for(dataset_id: str, index_struct: str | None) -> str:
    if index_struct:
        parsed = json.loads(index_struct)
        class_name = parsed.get("vector_store", {}).get("class_prefix")
        if class_name:
            return class_name
    return Dataset.gen_collection_name_by_id(dataset_id)


def load_statuses(client: httpx.Client) -> list[DatasetIndexStatus]:
    stmt = (
        select(
            Dataset.id,
            Dataset.name,
            Dataset.index_struct,
            func.count(DocumentSegment.id).label("segments"),
        )
        .join(DatasetDocument, DatasetDocument.dataset_id == Dataset.id)
        .join(DocumentSegment, DocumentSegment.document_id == DatasetDocument.id)
        .where(
            Dataset.indexing_technique == "high_quality",
            DatasetDocument.indexing_status == IndexingStatus.COMPLETED,
            DatasetDocument.enabled.is_(True),
            DatasetDocument.archived.is_(False),
            DocumentSegment.status == SegmentStatus.COMPLETED,
            DocumentSegment.enabled.is_(True),
        )
        .group_by(Dataset.id, Dataset.name, Dataset.index_struct)
        .order_by(Dataset.created_at.desc())
    )

    statuses: list[DatasetIndexStatus] = []
    for dataset_id, name, index_struct, segments in db.session.execute(stmt).all():
        dataset_id_str = str(dataset_id)
        class_name = collection_name_for(dataset_id_str, index_struct)
        resp = client.get(f"http://weaviate:8080/v1/schema/{class_name}")
        documents = [
            str(doc_id)
            for doc_id in db.session.scalars(
                select(DatasetDocument.id)
                .where(
                    DatasetDocument.dataset_id == dataset_id,
                    DatasetDocument.indexing_status == IndexingStatus.COMPLETED,
                    DatasetDocument.enabled.is_(True),
                    DatasetDocument.archived.is_(False),
                )
                .order_by(DatasetDocument.created_at.asc())
            ).all()
        ]
        statuses.append(
            DatasetIndexStatus(
                dataset_id=dataset_id_str,
                name=name,
                class_name=class_name,
                segments=int(segments),
                documents=documents,
                exists=resp.status_code == 200,
                status_code=resp.status_code,
            )
        )
    return statuses


def print_status(status: DatasetIndexStatus) -> None:
    state = "OK" if status.exists else "MISSING"
    print(
        f"{state}\tdataset={status.dataset_id}\tsegments={status.segments}"
        f"\tclass={status.class_name}\tname={status.name}",
        flush=True,
    )


repair = sys.argv[1] == "True"
with app.app_context():
    client = httpx.Client(timeout=10)
    statuses = load_statuses(client)
    print(f"high_quality_with_completed_segments={len(statuses)}", flush=True)
    for status in statuses:
        print_status(status)

    missing = [status for status in statuses if not status.exists]
    print(f"missing_count={len(missing)}", flush=True)
    if not missing:
        sys.exit(0)

    if not repair:
        print("Missing vector indexes found. Re-run with --repair to rebuild them.", file=sys.stderr, flush=True)
        sys.exit(1)

    failures: list[tuple[str, str]] = []
    for status in missing:
        print(f"REPAIR_START\tdataset={status.dataset_id}\tdocuments={len(status.documents)}", flush=True)
        for document_id in status.documents:
            try:
                add_document_to_index_task(document_id)
            except Exception as exc:
                failures.append((document_id, f"{exc.__class__.__name__}: {exc}"))
                print(f"REPAIR_DOCUMENT_FAILED\tdocument={document_id}\terror={failures[-1][1]}", flush=True)
        time.sleep(0.2)
        verify = client.get(f"http://weaviate:8080/v1/schema/{status.class_name}")
        if verify.status_code == 200:
            print(f"REPAIR_OK\tdataset={status.dataset_id}\tclass={status.class_name}", flush=True)
        else:
            failures.append((status.dataset_id, f"schema_status={verify.status_code}"))
            print(
                f"REPAIR_DATASET_FAILED\tdataset={status.dataset_id}\tclass={status.class_name}"
                f"\tstatus={verify.status_code}",
                flush=True,
            )

    if failures:
        print(f"repair_failures={len(failures)}", file=sys.stderr, flush=True)
        sys.exit(2)

    print("repair_complete", flush=True)
PY
