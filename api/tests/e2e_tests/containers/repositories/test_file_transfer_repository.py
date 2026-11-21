"""PostgreSQL concurrency coverage for the file transfer claim."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from repositories.file_transfer_repository import SQLAlchemyFileTransferRepository
from services.file_transfer import StoredFile, TransferDirection

pytestmark = pytest.mark.usefixtures("flask_req_ctx_with_containers")

_CLAIMANTS = 2


def test_two_claims_at_once_record_exactly_one_file() -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sessionmaker(bind=db.engine, expire_on_commit=False))
    now = naive_utc_now()
    transfer = repository.create(
        owner_id="owner",
        token_digest="d" * 64,
        direction=TransferDirection.IN,
        folder=False,
        file=None,
        now=now,
        expires_at=now + timedelta(minutes=40),
    )
    files = [
        StoredFile(
            name=f"{index}.bin", mime_type="application/octet-stream", size=1, sha256=f"{index}" * 64, received_at=now
        )
        for index in range(_CLAIMANTS)
    ]
    barrier = Barrier(_CLAIMANTS)

    def claim(file: StoredFile) -> bool:
        barrier.wait()
        return repository.claim(transfer_id=transfer.id, file=file)

    try:
        with ThreadPoolExecutor(max_workers=_CLAIMANTS) as pool:
            won = list(pool.map(claim, files))
        stored = repository.get(transfer_id=transfer.id, now=now)

        assert won.count(True) == 1
        assert stored is not None
        assert stored.file == files[won.index(True)]
    finally:
        repository.delete(transfer_ids=[transfer.id])


@pytest.mark.parametrize("transfer_id", ["not-a-uuid", "", "1234"])
def test_an_id_that_is_not_a_uuid_reads_as_nothing(transfer_id: str) -> None:
    """PostgreSQL refuses to compare a UUID column with such text; the repository must answer nothing instead."""
    repository = SQLAlchemyFileTransferRepository(session_factory=sessionmaker(bind=db.engine, expire_on_commit=False))
    now = naive_utc_now()

    assert repository.find(owner_id="owner", transfer_id=transfer_id, now=now) is None
    assert repository.get(transfer_id=transfer_id, now=now) is None
    assert repository.token_digest(transfer_id=transfer_id, now=now) is None
