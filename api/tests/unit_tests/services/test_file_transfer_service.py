import hashlib
from dataclasses import replace
from datetime import datetime, timedelta
from itertools import count

import pytest

from libs.archive_writer import ArchiveLimitKind, ArchiveTooLargeError
from services.file_transfer import (
    FileTransferService,
    IncomingFile,
    LoadedTransfer,
    PurgeResult,
    TransferAlreadyReceivedError,
    TransferArchiveError,
    TransferDirection,
    TransferLimits,
    TransferLinkExpiredError,
    TransferNotAZipError,
    TransferNotFoundError,
    TransferNotReceivedError,
    TransferRequestTooLargeError,
    TransferShapeError,
    TransferTooLargeError,
)
from tests.helpers.unit.libs.zip_builder import zip_bytes
from tests.unit_tests.services.file_transfer_fakes import InMemoryBlobs, InMemoryTransfers, SavePoint, SettableClock

_LIMITS = TransferLimits(
    ttl=timedelta(minutes=40),
    upload_link_life=timedelta(minutes=4),
    download_link_life=timedelta(minutes=3),
    max_bytes=10,
    max_unpacked_bytes=50,
    max_unpacked_files=3,
    max_per_owner=2,
    max_active=2,
    busy_retry_after=timedelta(seconds=7),
)
_START = datetime(2026, 11, 20, 10, 0)
_WORKERS = 4
_PDF = IncomingFile(name="r.pdf", mime_type="application/pdf", content=b"%PDF")


def _service(
    limits: TransferLimits = _LIMITS,
) -> tuple[FileTransferService, InMemoryTransfers, InMemoryBlobs, SettableClock]:
    transfers = InMemoryTransfers()
    blobs = InMemoryBlobs()
    clock = SettableClock(_START)
    tokens = count()
    service = FileTransferService(
        transfers=transfers,
        blobs=blobs,
        limits=limits,
        now=clock,
        new_token=lambda: f"token-{next(tokens)}",
    )
    return service, transfers, blobs, clock


def _load(service: FileTransferService, owner_id: str, transfer_id: str, *, folder: bool = False) -> LoadedTransfer:
    """A request's first load: it may hold the whole per-request limit."""
    return service.load(owner_id, transfer_id, may_hold=service.limits.max_bytes, folder=folder)


def _folder(members: dict[str, bytes]) -> IncomingFile:
    return IncomingFile(name="up.zip", mime_type="application/zip", content=zip_bytes(members))


def test_a_file_goes_in_and_comes_back_any_number_of_times() -> None:
    service, _, _, _ = _service()
    ticket = service.prepare("owner", folder=False)
    service.receive(ticket.transfer.id, ticket.token, _PDF)

    for _ in range(2):
        loaded = _load(service, "owner", ticket.transfer.id)
        assert [(f.path, f.name, f.mime_type, f.content) for f in loaded.files] == [
            ("r.pdf", "r.pdf", "application/pdf", b"%PDF")
        ]


def test_a_received_file_is_recorded_with_its_digest() -> None:
    service, _, _, clock = _service()
    ticket = service.prepare("owner", folder=False)

    transfer = service.receive(ticket.transfer.id, ticket.token, _PDF)

    assert transfer.file is not None
    assert (transfer.file.size, transfer.file.sha256, transfer.file.received_at) == (
        len(_PDF.content),
        hashlib.sha256(_PDF.content).hexdigest(),
        clock.current,
    )


def test_a_folder_is_a_zip_unpacked_at_use() -> None:
    service, _, _, _ = _service(replace(_LIMITS, max_bytes=10_000))
    ticket = service.prepare("owner", folder=True)
    service.receive(ticket.transfer.id, ticket.token, _folder({"SKILL.md": b"a", "s/run.py": b"b"}))

    files = _load(service, "owner", ticket.transfer.id, folder=True).files

    assert [(f.path, f.name, f.mime_type, f.content) for f in files] == [
        ("SKILL.md", "SKILL.md", "application/octet-stream", b"a"),
        ("s/run.py", "run.py", "application/octet-stream", b"b"),
    ]


def test_a_prepared_transfer_with_no_file_says_so() -> None:
    service, _, _, _ = _service()
    ticket = service.prepare("owner", folder=False)

    with pytest.raises(TransferNotReceivedError) as error:
        _load(service, "owner", ticket.transfer.id)

    assert error.value.upload_before == ticket.link_expires_at == _START + _LIMITS.upload_link_life


def test_another_owner_reads_as_not_found() -> None:
    service, _, _, _ = _service()
    ticket = service.prepare("owner", folder=False)
    service.receive(ticket.transfer.id, ticket.token, _PDF)

    with pytest.raises(TransferNotFoundError):
        _load(service, "other", ticket.transfer.id)


def test_an_expired_transfer_reads_as_not_found() -> None:
    service, _, _, clock = _service()
    ticket = service.prepare("owner", folder=False)
    service.receive(ticket.transfer.id, ticket.token, _PDF)
    clock.advance(_LIMITS.ttl)

    with pytest.raises(TransferNotFoundError):
        _load(service, "owner", ticket.transfer.id)


def test_the_upload_link_ends_before_the_id_does() -> None:
    service, _, _, clock = _service()
    ticket = service.prepare("owner", folder=False)
    clock.advance(_LIMITS.upload_link_life)

    with pytest.raises(TransferLinkExpiredError) as error:
        service.receive(ticket.transfer.id, ticket.token, _PDF)
    with pytest.raises(TransferNotReceivedError):
        _load(service, "owner", ticket.transfer.id)

    assert error.value.direction is TransferDirection.IN


def test_the_download_link_ends_before_the_id_does() -> None:
    service, _, _, clock = _service()
    ticket = service.park("owner", name="out.zip", mime_type="application/zip", content=b"pkg")
    assert b"".join(service.download(ticket.transfer.id, ticket.token)[1]) == b"pkg"
    clock.advance(_LIMITS.download_link_life)

    with pytest.raises(TransferLinkExpiredError) as error:
        service.download(ticket.transfer.id, ticket.token)

    assert error.value.direction is TransferDirection.OUT
    assert _load(service, "owner", ticket.transfer.id).files[0].content == b"pkg"


def test_a_link_never_outlives_its_transfer() -> None:
    service, _, _, _ = _service(replace(_LIMITS, upload_link_life=_LIMITS.ttl + timedelta(minutes=1)))

    ticket = service.prepare("owner", folder=False)

    assert ticket.link_expires_at == ticket.transfer.expires_at


def test_an_upload_cannot_be_downloaded_and_a_parked_file_cannot_receive() -> None:
    service, _, _, _ = _service()
    upload = service.prepare("owner", folder=False)
    service.receive(upload.transfer.id, upload.token, _PDF)
    parked = service.park("owner", name="out.zip", mime_type="application/zip", content=b"pkg")

    with pytest.raises(TransferNotFoundError):
        service.download(upload.transfer.id, upload.token)
    with pytest.raises(TransferNotFoundError):
        service.receive(parked.transfer.id, parked.token, _PDF)


def test_a_wrong_token_reads_as_not_found() -> None:
    service, _, _, _ = _service()
    ticket = service.prepare("owner", folder=False)

    with pytest.raises(TransferNotFoundError):
        service.open_for_upload(ticket.transfer.id, "not-the-token")
    with pytest.raises(TransferNotFoundError):
        service.open_for_upload("unknown", ticket.token)


def test_the_same_bytes_again_is_success_and_other_bytes_are_refused() -> None:
    service, _, _, _ = _service()
    ticket = service.prepare("owner", folder=False)
    first = service.receive(ticket.transfer.id, ticket.token, _PDF)

    again = service.receive(ticket.transfer.id, ticket.token, replace(_PDF, name="renamed.pdf"))
    with pytest.raises(TransferAlreadyReceivedError):
        service.receive(ticket.transfer.id, ticket.token, replace(_PDF, content=b"%PDF2"))

    assert again.file == first.file


def test_a_failed_store_releases_the_claim() -> None:
    service, _, blobs, _ = _service()
    ticket = service.prepare("owner", folder=False)
    blobs.fail_next_save()

    with pytest.raises(OSError, match="storage is down"):
        service.receive(ticket.transfer.id, ticket.token, _PDF)
    with pytest.raises(TransferNotReceivedError):
        _load(service, "owner", ticket.transfer.id)
    service.receive(ticket.transfer.id, ticket.token, _PDF)

    assert _load(service, "owner", ticket.transfer.id).files[0].content == _PDF.content


def test_a_failed_store_of_a_parked_file_leaves_no_transfer() -> None:
    service, transfers, blobs, _ = _service()
    blobs.fail_next_save()

    with pytest.raises(OSError, match="storage is down"):
        service.park("owner", name="out.zip", mime_type="application/zip", content=b"pkg")

    assert transfers.rows == {}


def test_missing_bytes_read_as_not_found() -> None:
    service, _, blobs, _ = _service()
    ticket = service.prepare("owner", folder=False)
    service.receive(ticket.transfer.id, ticket.token, _PDF)
    parked = service.park("owner", name="out.zip", mime_type="application/zip", content=b"pkg")
    blobs.clear()

    with pytest.raises(TransferNotFoundError):
        _load(service, "owner", ticket.transfer.id)
    with pytest.raises(TransferNotFoundError):
        service.download(parked.transfer.id, parked.token)


def test_a_file_at_the_limit_passes_and_one_byte_more_is_refused() -> None:
    service, _, _, _ = _service()
    at_limit = b"x" * _LIMITS.max_bytes
    ticket = service.prepare("owner", folder=False)

    with pytest.raises(TransferTooLargeError) as error:
        service.receive(ticket.transfer.id, ticket.token, replace(_PDF, content=at_limit + b"x"))
    with pytest.raises(TransferTooLargeError):
        service.park("owner", name="big", mime_type="application/zip", content=at_limit + b"x")
    service.receive(ticket.transfer.id, ticket.token, replace(_PDF, content=at_limit))

    assert error.value.limit == _LIMITS.max_bytes


def test_a_folder_upload_that_is_not_a_zip_is_refused_at_receive() -> None:
    service, _, _, _ = _service()
    ticket = service.prepare("owner", folder=True)

    with pytest.raises(TransferNotAZipError):
        service.receive(ticket.transfer.id, ticket.token, _PDF)


@pytest.mark.parametrize(
    ("members", "kind", "limit"),
    [
        ({"a": b"x" * (_LIMITS.max_unpacked_bytes + 1)}, ArchiveLimitKind.BYTES, _LIMITS.max_unpacked_bytes),
        (
            {str(index): b"" for index in range(_LIMITS.max_unpacked_files + 1)},
            ArchiveLimitKind.ENTRIES,
            _LIMITS.max_unpacked_files,
        ),
    ],
    ids=["bytes", "files"],
)
def test_a_zip_past_the_unpacked_limits_is_refused_at_load(
    members: dict[str, bytes], kind: ArchiveLimitKind, limit: int
) -> None:
    service, _, _, _ = _service(replace(_LIMITS, max_bytes=10_000))
    ticket = service.prepare("owner", folder=True)
    service.receive(ticket.transfer.id, ticket.token, _folder(members))

    with pytest.raises(TransferArchiveError) as error:
        _load(service, "owner", ticket.transfer.id, folder=True)

    archive_error = error.value.archive_error
    assert isinstance(archive_error, ArchiveTooLargeError)
    assert (archive_error.kind, archive_error.limit) == (kind, limit)


def _received(service: FileTransferService, content: bytes, *, folder: bool = False) -> str:
    ticket = service.prepare("owner", folder=folder)
    incoming = _folder({"a": content}) if folder else replace(_PDF, content=content)
    service.receive(ticket.transfer.id, ticket.token, incoming)
    return ticket.transfer.id


def test_a_file_above_what_the_request_may_still_hold_is_refused_before_any_storage_read() -> None:
    service, _, blobs, _ = _service()
    first = _received(service, b"1234")
    second = _received(service, b"1234567")
    held = service.load("owner", first, may_hold=_LIMITS.max_bytes, folder=False).held_bytes
    blobs.reads.clear()

    with pytest.raises(TransferRequestTooLargeError) as refused:
        service.load("owner", second, may_hold=_LIMITS.max_bytes - held, folder=False)

    assert refused.value.limit == _LIMITS.max_bytes
    assert blobs.reads == []


def test_files_that_together_fill_the_request_limit_exactly_load() -> None:
    service, _, _, _ = _service()
    first = _received(service, b"1234")
    second = _received(service, b"123456")

    held = service.load("owner", first, may_hold=_LIMITS.max_bytes, folder=False).held_bytes
    loaded = service.load("owner", second, may_hold=_LIMITS.max_bytes - held, folder=False)

    assert held + loaded.held_bytes == _LIMITS.max_bytes


def test_one_file_exactly_at_the_limit_still_loads() -> None:
    service, _, _, _ = _service()
    whole = _received(service, b"x" * _LIMITS.max_bytes)

    assert service.load("owner", whole, may_hold=_LIMITS.max_bytes, folder=False).held_bytes == _LIMITS.max_bytes


def test_the_same_id_counts_each_time_it_is_loaded() -> None:
    service, _, _, _ = _service()
    twice = _received(service, b"123456")
    held = service.load("owner", twice, may_hold=_LIMITS.max_bytes, folder=False).held_bytes

    with pytest.raises(TransferRequestTooLargeError):
        service.load("owner", twice, may_hold=_LIMITS.max_bytes - held, folder=False)


def test_a_folder_unpacking_past_what_the_request_may_still_hold_is_refused_as_the_request() -> None:
    service, _, _, _ = _service(replace(_LIMITS, max_bytes=1_000))
    folder_id = _received(service, b"x" * 8, folder=True)

    with pytest.raises(TransferRequestTooLargeError) as refused:
        service.load("owner", folder_id, may_hold=5, folder=True)

    assert refused.value.limit == 1_000
    assert service.load("owner", folder_id, may_hold=8, folder=True).held_bytes == 8


def test_a_new_transfer_drops_the_owners_expired_ones_then_its_oldest() -> None:
    service, transfers, blobs, clock = _service()
    first = service.park("owner", name="1", mime_type="text/plain", content=b"1")
    clock.advance(timedelta(seconds=1))
    second = service.park("owner", name="2", mime_type="text/plain", content=b"2")
    clock.advance(timedelta(seconds=1))
    other = service.park("other", name="o", mime_type="text/plain", content=b"o")
    clock.advance(timedelta(seconds=1))

    third = service.prepare("owner", folder=False)

    assert [transfer.id for transfer in transfers.owned(owner_id="owner")] == [second.transfer.id, third.transfer.id]
    assert set(blobs.files) == {f"file_transfers/{second.transfer.id}", f"file_transfers/{other.transfer.id}"}
    with pytest.raises(TransferNotFoundError):
        _load(service, "owner", first.transfer.id)


def test_expired_transfers_go_first_when_room_is_made() -> None:
    service, transfers, _, clock = _service()
    expired = service.prepare("owner", folder=False)
    clock.advance(_LIMITS.ttl)
    live = service.prepare("owner", folder=False)
    clock.advance(timedelta(seconds=1))

    newest = service.prepare("owner", folder=False)

    assert expired.transfer.id not in transfers.rows
    assert [transfer.id for transfer in transfers.owned(owner_id="owner")] == [live.transfer.id, newest.transfer.id]


@pytest.mark.parametrize("point", list(SavePoint))
def test_an_upload_dropped_to_make_room_while_it_is_stored_keeps_no_bytes(point: SavePoint) -> None:
    service, transfers, blobs, _ = _service()
    uploading = service.prepare("owner", folder=False)
    service.prepare("owner", folder=False)
    blobs.during_next_save(point, lambda: service.prepare("owner", folder=False))

    with pytest.raises(TransferNotFoundError):
        service.receive(uploading.transfer.id, uploading.token, _PDF)

    assert uploading.transfer.id not in transfers.rows
    assert blobs.files == {}


@pytest.mark.parametrize("point", list(SavePoint))
def test_a_parked_file_dropped_to_make_room_while_it_is_stored_keeps_no_bytes(point: SavePoint) -> None:
    service, transfers, blobs, _ = _service()

    def two_more_transfers() -> None:
        service.prepare("owner", folder=False)
        service.prepare("owner", folder=False)

    blobs.during_next_save(point, two_more_transfers)

    with pytest.raises(TransferNotFoundError):
        service.park("owner", name="out.zip", mime_type="application/zip", content=b"pkg")

    assert len(transfers.owned(owner_id="owner")) == _LIMITS.max_per_owner
    assert blobs.files == {}


def test_a_failed_delete_of_bytes_leaves_the_ended_transfer_to_the_next_purge() -> None:
    service, transfers, blobs, _ = _service()
    dropped = service.park("owner", name="1", mime_type="text/plain", content=b"1")
    service.prepare("owner", folder=False)
    blobs.fail_next_delete()

    with pytest.raises(OSError, match="storage is down"):
        service.prepare("owner", folder=False)
    with pytest.raises(TransferNotFoundError):
        service.download(dropped.transfer.id, dropped.token)

    assert service.purge_expired(limit=10, workers=_WORKERS).removed == 1
    assert dropped.transfer.id not in transfers.rows
    assert blobs.files == {}


def test_purge_removes_rows_and_bytes_of_expired_transfers_only() -> None:
    service, transfers, blobs, clock = _service()
    old = service.park("owner", name="old", mime_type="text/plain", content=b"old")
    empty = service.prepare("other", folder=False)
    clock.advance(_LIMITS.ttl)
    fresh = service.park("third", name="new", mime_type="text/plain", content=b"new")

    assert service.purge_expired(limit=10, workers=_WORKERS).removed == 2

    assert set(transfers.rows) == {fresh.transfer.id}
    assert set(blobs.files) == {f"file_transfers/{fresh.transfer.id}"}
    assert empty.transfer.id not in transfers.rows
    assert old.transfer.id not in transfers.rows


def test_purge_stops_at_its_limit_oldest_first() -> None:
    service, transfers, _, clock = _service()
    first = service.prepare("a", folder=False)
    clock.advance(timedelta(seconds=1))
    second = service.prepare("b", folder=False)
    clock.advance(_LIMITS.ttl)

    assert service.purge_expired(limit=1, workers=_WORKERS).removed == 1

    assert set(transfers.rows) == {second.transfer.id}
    assert first.transfer.id not in transfers.rows


def test_purge_says_how_overdue_the_most_overdue_transfer_was() -> None:
    service, _, _, clock = _service()
    service.prepare("a", folder=False)
    clock.advance(timedelta(seconds=1))
    service.prepare("b", folder=False)
    clock.advance(_LIMITS.ttl + timedelta(seconds=30))

    result = service.purge_expired(limit=10, workers=_WORKERS)

    assert (result.removed, result.longest_overdue) == (2, timedelta(seconds=31))
    assert service.purge_expired(limit=10, workers=_WORKERS) == PurgeResult(removed=0, longest_overdue=timedelta(0))


def test_purge_deletes_many_transfers_bytes_at_once() -> None:
    service, transfers, blobs, clock = _service(replace(_LIMITS, max_per_owner=50))
    for index in range(30):
        service.park("owner", name=str(index), mime_type="text/plain", content=b"x")
    clock.advance(_LIMITS.ttl)

    assert service.purge_expired(limit=50, workers=_WORKERS).removed == 30

    assert (transfers.rows, blobs.files) == ({}, {})


def test_the_sweep_deletes_stored_bytes_without_a_row_and_keeps_the_rest() -> None:
    service, _, blobs, clock = _service()
    ended = service.park("other", name="ended", mime_type="text/plain", content=b"ended")
    clock.advance(_LIMITS.ttl)
    live = service.park("owner", name="live", mime_type="text/plain", content=b"live")
    blobs.files["file_transfers/left-behind"] = b"orphan"
    blobs.files["elsewhere/kept"] = b"not ours"

    assert service.sweep_orphans(workers=_WORKERS) == 1

    assert set(blobs.files) == {
        f"file_transfers/{live.transfer.id}",
        f"file_transfers/{ended.transfer.id}",
        "elsewhere/kept",
    }


def test_the_sweep_of_storage_that_never_held_a_transfer_deletes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    service, _, blobs, _ = _service()

    def no_folder(path: str) -> list[str]:
        raise FileNotFoundError(path)

    monkeypatch.setattr(blobs, "scan", no_folder)

    assert service.sweep_orphans(workers=_WORKERS) == 0


def test_only_the_digest_of_the_token_reaches_the_repository() -> None:
    service, transfers, _, _ = _service()

    ticket = service.prepare("owner", folder=False)

    assert transfers.digests[ticket.transfer.id] == hashlib.sha256(ticket.token.encode()).hexdigest()
    assert ticket.token not in transfers.digests.values()


def test_slots_refuse_past_max_active_and_free_again() -> None:
    service, _, _, _ = _service()

    taken = [service.take_slot() for _ in range(_LIMITS.max_active)]
    refused = service.take_slot()
    service.free_slot()

    assert taken == [True] * _LIMITS.max_active
    assert refused is False
    assert service.take_slot() is True


def test_a_zero_byte_file_is_a_file() -> None:
    service, _, _, _ = _service()
    ticket = service.prepare("owner", folder=False)

    service.receive(ticket.transfer.id, ticket.token, replace(_PDF, content=b""))

    assert _load(service, "owner", ticket.transfer.id).files[0].content == b""


def test_open_for_download_reads_no_bytes() -> None:
    service, _, blobs, _ = _service()
    parked = service.park("owner", name="out.zip", mime_type="application/zip", content=b"pkg")
    blobs.clear()

    assert service.open_for_download(parked.transfer.id, parked.token) == parked.transfer


@pytest.mark.parametrize("folder", [True, False], ids=["folder asked, file held", "file asked, folder held"])
def test_a_transfer_of_the_other_shape_is_refused_before_any_storage_read(folder: bool) -> None:
    service, _, blobs, _ = _service(replace(_LIMITS, max_bytes=10_000))
    held = _received(service, b"abc", folder=not folder)
    blobs.reads.clear()

    with pytest.raises(TransferShapeError) as refused:
        service.load("owner", held, may_hold=_LIMITS.max_bytes, folder=folder)

    assert refused.value.folder is (not folder)
    assert blobs.reads == []
