"""Independent Stop/Resume coordinator; native cancellation stays outside SQL."""

from copy import deepcopy
from dataclasses import asdict
from uuid import uuid4

from pydantic import TypeAdapter
from sqlalchemy import select

from core.dify_builder.contract import SessionView
from core.dify_builder.errors import BadRequestError, ConflictError, NotFoundError
from core.dify_builder.models import Action, Actor
from core.dify_builder.state import PcState, is_terminal
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderRun
from services.dify_builder.task_controls import generation


def _intent(kind, base_version, base_app_revision):
    return {"kind": kind, "base_version": base_version, "base_app_revision": base_app_revision}


def _saved(service, session_id, key, intent, *, sql=None):
    receipt = service._repo.find_task_control(session_id, key, sql=sql)
    if receipt and receipt["intent"] != intent:
        raise ConflictError("task control identity reused with different intent")
    return receipt


def _authorize_locked(session, actor):
    if session.tenant_id != actor.tenant_id or session.owner_account_id != actor.account_id:
        raise NotFoundError("session not found")


def _replay(service, session_id, receipt):
    if receipt.get("view"):
        return TypeAdapter(SessionView).validate_python(receipt["view"])
    while True:
        session, context = service._repo.get_session(session_id)
        if context.task_control.get("receipt", {}).get("id") != receipt["id"]:
            session, context = service._repo.get_session_at_version(session_id, receipt["version"])
            return service._build_session_view(session, context)
        view = service._build_session_view(session, context)
        saved = False

        def save(_sql, current, fc, view=view):
            nonlocal saved
            if current.version != view.version:
                return False
            view.version = current.version + 1
            fc.task_control["receipt"]["view"] = asdict(view)
            fc.task_control["receipt"]["version"] = view.version
            saved = True
            return True

        service._repo.control_transaction(session_id, save)
        if saved:
            return view
        receipt = service._repo.find_task_control(session_id, receipt["id"])
        if receipt.get("view"):
            return TypeAdapter(SessionView).validate_python(receipt["view"])


def control(
    service,
    session_id: str,
    actor: Actor,
    *,
    kind: str,
    base_version: int,
    client_action_id: str,
    base_app_revision: str,
):
    from services.dify_builder.service import AppAccess

    session, context = service._get_authorized_session(session_id, actor, AppAccess.EDIT)
    if type(base_version) is not int or base_version < 1 or not client_action_id.strip():
        raise BadRequestError("base_version and client_action_id are required")
    if context.test_input_ref and kind == "stop":
        service._authorize_app(session.app_id, actor, AppAccess.TEST_AND_RUN)
    intent = _intent(kind, base_version, base_app_revision)
    saved = _saved(service, session_id, client_action_id, intent)
    if saved:
        if saved.get("settlement") in {"pending", "unknown"}:
            _settle_stop(service._repo, service._test_actions, session_id, actor, client_action_id)
            saved = _saved(service, session_id, client_action_id, intent)
        view = _replay(service, session_id, saved)
        if kind == "resume" and saved.get("enqueue") in {"pending", "dispatching", "claimed"}:
            _enqueue_resume(service, session_id, actor, saved)
        return view
    _, observed = service._repo.get_session_at_version(session_id, base_version)
    expected_generation = generation(observed)
    old_owner = service._session_lock.current_owner(session_id)
    dsl = None
    if kind == "resume":
        # Read complete DSL before reserving continuation, outside the SQL writer.
        dsl, revision = service._read_task_dsl_fn(session.app_id, actor)
    else:
        revision = ""

    def write(sql, current, fc):
        _authorize_locked(current, actor)
        if _saved(service, session_id, client_action_id, intent, sql=sql):
            return False
        if generation(fc) != expected_generation or is_terminal(current.current_state):
            raise ConflictError("task control targets a superseded or completed task")
        controls = deepcopy(fc.task_control)
        receipt = {
            "id": client_action_id,
            "intent": intent,
            "version": current.version + 1,
            "generation": expected_generation,
            "settlement": "settled",
        }
        if kind == "stop":
            requests = (
                list(
                    sql.scalars(
                        select(DifyBuilderExecutionRequest)
                        .where(
                            DifyBuilderExecutionRequest.session_id == session_id,
                            DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                            DifyBuilderExecutionRequest.actor_id == actor.account_id,
                            DifyBuilderExecutionRequest.test_input_id == fc.test_input_ref,
                        )
                        .order_by(DifyBuilderExecutionRequest.created_at.desc(), DifyBuilderExecutionRequest.id.desc())
                    )
                )
                if fc.test_input_ref
                else []
            )
            native = [r for r in requests if r.context.get("policy_version") == "builder-native-test-v1"]
            request_id = native[0].id if native else ""
            run_ids = (
                list(
                    sql.scalars(
                        select(DifyBuilderRun.id).where(
                            DifyBuilderRun.session_id == session_id,
                            DifyBuilderRun.inputs_ref == fc.test_input_ref,
                            DifyBuilderRun.immutable.is_(False),
                        )
                    )
                )
                if fc.test_input_ref
                else []
            )
            ordinary_ids = [r.id for r in requests if r not in native]
            controls["ordinary_run_ids"] = run_ids
            controls["ordinary_request_ids"] = ordinary_ids
            controls["stopped_state"] = str(current.current_state)
            controls["settlement"] = "pending" if request_id or run_ids or ordinary_ids else "settled"
            controls["native_request_id"] = request_id or ""
            receipt["settlement"] = controls["settlement"]
            fc.paused = True
        else:
            if not fc.paused or controls.get("settlement", "settled") != "settled":
                raise ConflictError("task stop has not safely settled")
            from services.dify_builder.task_controls import validate_dsl_binding

            assert dsl is not None
            validate_dsl_binding(sql, dsl)
            controls["generation"] = expected_generation + 1
            controls["dsl_before_resume"] = controls.get("dsl", {})
            controls["dsl"] = dsl
            controls["dsl_revision"] = revision
            # Every previously proposed mutation and execution consent is obsolete.
            fc.staged_repair = []
            fc.change_set = None
            fc.effect_confirmation = {}
            fc.effect_confirmation_form = {}
            fc.code_risk_assessments = {}
            fc.confirmed_command_id = ""
            fc.confirmed_consent_id = ""
            fc.retained_test_input_ref = fc.test_input_ref or fc.retained_test_input_ref
            fc.test_input_ref = ""
            fc.verify_run_id = ""
            fc.recovery_class = ""
            fc.last_snapshot_hash = revision
            current.current_state = safe_continuation(current.current_state, fc, dsl)
            fc.paused = False
            receipt["generation"] = expected_generation + 1
            receipt["enqueue"] = "pending"
        controls["receipt"] = receipt
        fc.task_control = controls
        fc.last_command_id = client_action_id
        return True

    current, fc = service._repo.control_transaction(session_id, write)
    if kind == "stop":
        from services.dify_builder.progress_bus import publish_native_change

        publish_native_change(session_id)
        # Release only the owner captured before the stop fence committed.
        if old_owner:
            service._session_lock.release(session_id, old_owner)
        candidate = service._session_lock.current_owner(session_id)
        if candidate and candidate.startswith(f"g{expected_generation}:"):
            service._session_lock.release(session_id, candidate)
        _settle_stop(service._repo, service._test_actions, session_id, actor, client_action_id)
    else:
        # Finalize the exact receipt before a worker can capture its CAS base.
        # Response persistence must never advance the head of active cognition.
        saved = _saved(service, session_id, client_action_id, intent)
        view = _replay(service, session_id, saved)
        _enqueue_resume(service, session_id, actor, fc.task_control["receipt"])
        return view
    saved = _saved(service, session_id, client_action_id, intent)
    return _replay(service, session_id, saved)


def _settle_stop(repo, test_actions, session_id, actor, key, *, deliver=True):
    _, context = repo.get_session(session_id)
    controls = context.task_control
    if controls.get("settlement") not in {"pending", "unknown"} or controls.get("receipt", {}).get("id") != key:
        return
    settlement = "settled"
    request_id = controls.get("native_request_id")
    if request_id:
        settlement = "pending"
    if request_id and test_actions is not None:
        from services.dify_builder.test_actions import TestCommand

        try:
            if deliver:
                receipt = test_actions.execute(
                    actor=actor,
                    session_id=session_id,
                    test_input_id=context.test_input_ref,
                    command=TestCommand("cancel", request_id, {}),
                    idempotency_key="task-stop:" + key,
                )
            else:
                receipt = test_actions.current(actor=actor, session_id=session_id, test_input_id=context.test_input_ref)
                if receipt is None or receipt.request_id != request_id:
                    return
            settlement = (
                "unknown" if receipt.outcome == "unknown" else "settled" if receipt.status == "terminal" else "pending"
            )
        except Exception:
            # Intent is durable. An authenticated retry reconciles this identity.
            settlement = "pending"
    if controls.get("ordinary_run_ids") or controls.get("ordinary_request_ids"):
        from services.dify_builder.task_native_cancel import settle_ordinary

        try:
            ordinary = settle_ordinary(
                repo,
                session_id=session_id,
                actor=actor,
                run_ids=controls.get("ordinary_run_ids", []),
                request_ids=controls.get("ordinary_request_ids", []),
                deliver=deliver,
            )
            if ordinary == "unknown" or settlement == "unknown":
                settlement = "unknown"
            elif ordinary == "pending" or settlement == "pending":
                settlement = "pending"
        except Exception:
            settlement = "pending"
    if settlement == "pending":
        return

    def settle(_sql, session, fc):
        if not fc.paused or fc.task_control.get("receipt", {}).get("id") != key:
            return False
        if fc.task_control.get("settlement") == settlement:
            return False
        fc.task_control["settlement"] = settlement
        receipt = fc.task_control["receipt"]
        receipt["settlement"] = settlement
        # Settlement advances the current projection, while an acknowledged
        # response remains immutable for exact historical command replay.
        if not receipt.get("view"):
            receipt["version"] = session.version + 1
        return True

    repo.control_transaction(session_id, settle)


def _enqueue_resume(service, session_id, actor, receipt):
    current, context = service._repo.get_session(session_id)
    latest = context.task_control.get("receipt", {})
    if (
        context.paused
        or generation(context) != receipt["generation"]
        or latest.get("id") != receipt["id"]
        or latest.get("enqueue") in {"running", "settled"}
        or service._session_lock.exists(session_id)
    ):
        return
    delivery_id = str(uuid4())

    def reserve(_sql, session, fc):
        command = fc.task_control.get("receipt", {})
        if (
            fc.paused
            or generation(fc) != receipt["generation"]
            or command.get("id") != receipt["id"]
            or command.get("enqueue") in {"running", "settled"}
        ):
            raise ConflictError("continuation already delivered or superseded")
        command["enqueue"] = "dispatching"
        command["delivery_id"] = delivery_id
        return True

    current, context = service._repo.control_transaction(session_id, reserve)
    action = Action(
        kind="task_continue",
        base_version=current.version,
        command_id=receipt["id"],
        execution_generation=receipt["generation"],
        payload={"task_control_delivery": delivery_id},
    )
    try:
        service.dispatch(session_id, action, actor)
    except Exception:

        def failed(_sql, session, fc):
            command = fc.task_control.get("receipt", {})
            if command.get("delivery_id") != delivery_id or command.get("enqueue") != "dispatching":
                return False
            command["enqueue"] = "pending"
            return True

        service._repo.control_transaction(session_id, failed)
        raise


def claim_continuation(repo, session_id, actor, action):
    """Only one delivery may run a reserved continuation, even after lease expiry."""

    def claim(_sql, session, fc):
        _authorize_locked(session, actor)
        receipt = fc.task_control.get("receipt", {})
        if (
            fc.paused
            or generation(fc) != action.execution_generation
            or receipt.get("id") != action.command_id
            or receipt.get("enqueue") != "dispatching"
            or receipt.get("delivery_id") != action.payload.get("task_control_delivery")
        ):
            raise ConflictError("stale or duplicate task continuation")
        receipt["enqueue"] = "claimed"
        return True

    session, _ = repo.control_transaction(session_id, claim)
    action.base_version = session.version


def safe_continuation(state, context, dsl):
    """Preserve unfinished gates; privileged handlers require fresh user admission."""
    mapping = {
        PcState.BUILD_PUBLISH: PcState.BUILD_REVIEW,
        PcState.EDIT_PUBLISH: PcState.EDIT_REVIEW,
        PcState.FIX_PUBLISH: PcState.FIX_AWAIT_DECISION,
        PcState.BUILD_TEST_AND_REPAIR: PcState.BUILD_AWAIT_TESTDATA,
        PcState.EDIT_TEST_AFFECTED_PATHS: PcState.EDIT_AWAIT_TESTDATA,
        PcState.FIX_VERIFY: PcState.FIX_AWAIT_TESTDATA,
        PcState.FIX_APPLY: PcState.FIX_PROPOSE,
        PcState.FIX_AWAIT_APPROVAL: PcState.FIX_PROPOSE,
        PcState.BUILD_PLAN_APPROVAL: PcState.BUILD_INITIAL_PLAN,
        PcState.BUILD_AWAIT_REPAIR: PcState.BUILD_AWAIT_TESTDATA,
        PcState.EDIT_AWAIT_REPAIR: PcState.EDIT_AWAIT_TESTDATA,
        PcState.EDIT_APPLY_CHANGES: PcState.EDIT_IMPACT_ANALYSIS,
        PcState.EDIT_PLAN_APPROVAL: PcState.EDIT_IMPACT_ANALYSIS,
    }
    return mapping.get(state, state)


def refresh_continuation(repo, dify, session_id, actor, action):
    """Refresh pause-period/autosave DSL before this delivery's first model call."""
    from services.dify_builder.task_controls import validate_dsl_binding

    session, _ = repo.get_session(session_id)
    dsl, revision = dify.read_task_dsl(session.app_id, actor)

    def synchronize(sql, current, fc):
        if fc.paused or generation(fc) != action.execution_generation:
            raise ConflictError("continuation superseded")
        receipt = fc.task_control.get("receipt", {})
        if (
            receipt.get("id") != action.command_id
            or receipt.get("enqueue") != "claimed"
            or receipt.get("delivery_id") != action.payload.get("task_control_delivery")
        ):
            raise ConflictError("continuation delivery superseded")
        validate_dsl_binding(sql, dsl)
        receipt["enqueue"] = "running"
        fc.task_control["dsl_before_resume"] = fc.task_control.get("dsl", {})
        fc.task_control["dsl"] = dsl
        fc.task_control["dsl_revision"] = revision
        fc.last_snapshot_hash = revision
        return True

    current, _ = repo.control_transaction(session_id, synchronize)
    action.base_version = current.version


def observe_stop(repo, test_actions, session_id, actor):
    """Reconcile terminal evidence without delivering cancellation or execution."""
    _, context = repo.get_session(session_id)
    if context.paused and context.task_control.get("settlement") in {"pending", "unknown"}:
        _settle_stop(repo, test_actions, session_id, actor, context.task_control["receipt"]["id"], deliver=False)


def release_unstarted_continuation(repo, session_id, action):
    """Preparation failed before cognition; a same-command retry may reserve again."""

    def release(_sql, session, fc):
        receipt = fc.task_control.get("receipt", {})
        if (
            fc.paused
            or receipt.get("id") != action.command_id
            or receipt.get("enqueue") != "claimed"
            or receipt.get("delivery_id") != action.payload.get("task_control_delivery")
        ):
            return False
        receipt["enqueue"] = "pending"
        receipt.pop("view", None)
        return True

    repo.control_transaction(session_id, release)
