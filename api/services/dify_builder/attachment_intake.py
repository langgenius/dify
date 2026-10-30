"""Conversation-local supplemental material using the existing advance/CAS owner.

Submission persists references only. Extraction runs outside transactions and a
fixed watermark is consumed with the session CAS; Stop/task replacement fences
both results and prompt context. Uploads remain candidates for native TestInput,
never automatically bound inputs, permissions, credentials or resource identity.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Protocol
from uuid import UUID

from core.dify_builder.errors import BadRequestError
from core.dify_builder.models import Actor, DifyBuilderContext, EntryMode, Session
from core.dify_builder.state import PcState
from services.dify_builder.attachment_extraction import ExtractedContext
from services.dify_builder.business_acceptance import clear_task_acceptance
from services.dify_builder.task_controls import check_current, generation

MAX_PROMPT_CHARS = 40_000


def material_task_id(session: Session, context: DifyBuilderContext) -> str:
    """The existing Task generation is stable across mutable checkpoint/approval records."""
    return f"{session.id}:{generation(context)}"


@dataclass(frozen=True)
class MaterialReceipt:
    id: str
    seq: int
    app_id: str
    session_id: str
    task_id: str
    generation: int
    client_turn_id: str
    text: str
    uploads: list[dict]
    status: str
    consumed_version: int | None
    test_candidate: bool


@dataclass(frozen=True)
class MaterialResult:
    receipt_id: str
    uploads: list[dict]
    text_truncated: bool = False


@dataclass(frozen=True)
class NativeContextUpload:
    upload_file_id: str
    key: str
    extension: str
    size: int


class MaterialRepository(Protocol):
    """Every operation checks tenant/account/App/session/task/generation.

    Queue locks the session row to serialize ordered intake, replay digests and
    the 20-reference limit without changing an in-flight context. Consume
    atomically commits the existing session version CAS with the fixed pending
    watermark. A missing owner raises NotFound; stale generation/version raises
    Conflict. No port holds SQL while reading storage or calling a parser/model.
    """

    def authorize_builder_uploads(self, actor: Actor, upload_file_ids: list[str]) -> None: ...
    def queue_builder_material(
        self,
        session_id: str,
        actor: Actor,
        *,
        expected_generation: int,
        task_id: str,
        client_turn_id: str,
        text: str,
        upload_file_ids: list[str],
        as_message: bool = False,
    ) -> MaterialReceipt: ...
    def list_builder_material(self, session_id: str, actor: Actor) -> list[MaterialReceipt]: ...
    def find_builder_material(self, session_id: str, actor: Actor, client_turn_id: str) -> MaterialReceipt | None: ...
    def read_builder_upload(
        self,
        session_id: str,
        actor: Actor,
        *,
        receipt_id: str,
        upload_file_id: str,
        expected_generation: int,
        task_id: str,
    ) -> NativeContextUpload: ...
    def consume_builder_material(
        self,
        session_id: str,
        actor: Actor,
        *,
        base_version: int,
        expected_generation: int,
        task_id: str,
        watermark: int,
        results: list[MaterialResult],
        context: DifyBuilderContext,
        next_state: PcState,
    ) -> int: ...


def validated_upload_ids(values: list[str] | None) -> list[str]:
    if values is None:
        return []
    if not isinstance(values, list) or len(values) > 5:
        raise BadRequestError("At most 5 upload references are allowed")
    try:
        ids = [str(UUID(value)) for value in values]
    except (ValueError, TypeError, AttributeError) as exc:
        raise BadRequestError("Invalid upload reference") from exc
    if len(set(ids)) != len(ids):
        raise BadRequestError("Duplicate upload reference")
    return ids


def _prompt_cost(text: str) -> int:
    return len(json.dumps(text, ensure_ascii=False)) + 256


def _prompt_excerpt(text: str, remaining: int) -> str:
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if _prompt_cost(text[:middle]) <= remaining:
            low = middle
        else:
            high = middle - 1
    return text[:low]


class BuilderAttachmentIntake:
    def __init__(self, repo: MaterialRepository, extract: Callable[[NativeContextUpload], ExtractedContext]) -> None:
        self._repo = repo
        self._extract = extract

    def authorize_uploads(self, actor: Actor, upload_file_ids: list[str]) -> None:
        self._repo.authorize_builder_uploads(actor, upload_file_ids)

    def find_turn(self, session: Session, actor: Actor, client_turn_id: str) -> MaterialReceipt | None:
        return self._repo.find_builder_material(session.id, actor, client_turn_id)

    def pending(self, session: Session, context: DifyBuilderContext, actor: Actor) -> list[MaterialReceipt]:
        return [
            row
            for row in self._repo.list_builder_material(session.id, actor)
            if row.status == "pending"
            and row.generation == generation(context)
            and row.task_id == material_task_id(session, context)
        ]

    def submit(
        self,
        session: Session,
        context: DifyBuilderContext,
        actor: Actor,
        *,
        text: str,
        upload_file_ids: list[str] | None,
        client_turn_id: str,
        as_message: bool = False,
    ) -> MaterialReceipt:
        ids = validated_upload_ids(upload_file_ids)
        if not isinstance(text, str) or len(text) > 20_000 or (not text.strip() and not ids):
            raise BadRequestError("Message text or attachments are required (text limit: 20000 characters)")
        if not isinstance(client_turn_id, str) or not client_turn_id.strip() or len(client_turn_id) > 128:
            raise BadRequestError("client_turn_id is required")
        return self._repo.queue_builder_material(
            session.id,
            actor,
            expected_generation=generation(context),
            task_id=material_task_id(session, context),
            client_turn_id=client_turn_id,
            text=text.strip(),
            upload_file_ids=ids,
            as_message=as_message,
        )

    def receipts(self, session: Session, actor: Actor) -> list[dict]:
        return [
            {
                "id": row.id,
                "seq": row.seq,
                "app_id": row.app_id,
                "session_id": row.session_id,
                "task_id": row.task_id,
                "generation": row.generation,
                "client_turn_id": row.client_turn_id,
                "status": row.status,
                "consumed_version": row.consumed_version,
                "test_input_candidate": row.test_candidate,
                "attachments": [
                    {key: value for key, value in upload.items() if key != "text"} for upload in row.uploads
                ],
            }
            for row in self._repo.list_builder_material(session.id, actor)
        ]

    def consume(
        self, session: Session, context: DifyBuilderContext, actor: Actor
    ) -> tuple[Session, DifyBuilderContext, bool]:
        """At one handler boundary, capture a prefix, extract, then CAS its results."""
        check_current()
        task_id = material_task_id(session, context)
        rows = self.pending(session, context, actor)
        if not rows:
            return session, context, False
        watermark = rows[-1].seq
        results: list[MaterialResult] = []
        material = [item for item in context.attachment_material if item.get("generation", 0) == generation(context)]
        remaining = MAX_PROMPT_CHARS - 1024 - sum(_prompt_cost(value.get("text", "")) for value in material)
        for row in rows:
            text_truncated = False
            if row.text:
                excerpt = _prompt_excerpt(row.text, remaining)
                text_truncated = len(excerpt) < len(row.text)
                remaining -= _prompt_cost(excerpt)
                material.append(
                    {
                        "receipt_id": row.id,
                        "source": "user_supplement",
                        "text": excerpt,
                        "task_id": task_id,
                        "generation": row.generation,
                    }
                )
            uploads = []
            for ref in row.uploads:
                check_current()
                upload = self._repo.read_builder_upload(
                    session.id,
                    actor,
                    receipt_id=row.id,
                    upload_file_id=ref["upload_file_id"],
                    expected_generation=row.generation,
                    task_id=task_id,
                )
                extracted = self._extract(upload)
                check_current()
                text = extracted.text if row.test_candidate else _prompt_excerpt(extracted.text, remaining)
                if not row.test_candidate:
                    remaining -= _prompt_cost(text)
                status = (
                    "rejected"
                    if extracted.status == "rejected"
                    else "truncated"
                    if (extracted.status == "truncated" or len(text) < len(extracted.text))
                    else "consumed"
                )
                item = {
                    **ref,
                    "status": status,
                    "text": text,
                    "digest": extracted.digest,
                    "reason": "prompt_limit" if len(text) < len(extracted.text) else extracted.reason,
                }
                uploads.append(item)
                if text and not row.test_candidate:
                    material.append(
                        {
                            "receipt_id": row.id,
                            "source": "attachment",
                            "upload_file_id": upload.upload_file_id,
                            "text": text,
                            "task_id": task_id,
                            "generation": row.generation,
                        }
                    )
            results.append(MaterialResult(row.id, uploads, text_truncated=text_truncated))
        updated = replace(context, attachment_material=material)
        next_state = session.current_state
        # Supplemental material cannot inherit plan/test approval. Re-enter the
        # current scenario's ordinary cognition and its explicit approval gate.
        if any(row.text or not row.test_candidate for row in rows):
            clear_task_acceptance(updated)
            updated.test_input_ref = ""
            updated.confirmed_consent_id = ""
            updated.confirmed_command_id = ""
            updated.effect_confirmation = {}
            updated.effect_confirmation_form = {}
            updated.resource_selection = {}
            updated.staged_repair = []
            updated.change_set = None
            updated.recovery_class = ""
            mode = updated.active_entry_mode or str(session.entry_mode)
            next_state = {
                str(EntryMode.BUILD): PcState.BUILD_CAPABILITY_CHECK,
                str(EntryMode.EDIT): PcState.EDIT_CAPABILITY_CHECK,
                str(EntryMode.FIX_CHECKLIST): PcState.CHECKLIST_DIAGNOSE,
            }.get(mode, PcState.FIX_DIAGNOSE)
        version = self._repo.consume_builder_material(
            session.id,
            actor,
            base_version=session.version,
            expected_generation=generation(context),
            task_id=task_id,
            watermark=watermark,
            results=results,
            context=updated,
            next_state=next_state,
        )
        return replace(session, version=version, current_state=next_state), updated, next_state != session.current_state
