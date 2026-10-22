import logging
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any, cast

from celery import current_app, group, shared_task
from celery.app import backends
from celery.backends.asynchronous import geventDrainer
from celery.backends.redis import RedisBackend
from sqlalchemy import and_, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.schedule_utils import calculate_next_run_at
from models.trigger import AppTrigger, AppTriggerStatus, AppTriggerType, WorkflowSchedulePlan
from tasks.workflow_schedule_tasks import run_schedule_trigger

logger = logging.getLogger(__name__)


@shared_task(queue="schedule_poller")
def poll_workflow_schedules() -> None:
    """
    Poll and process due workflow schedules.

    Streaming flow:
    1. Fetch due schedules in batches
    2. Process each batch until all due schedules are handled
    3. Optional: Limit total dispatches per tick as a circuit breaker
    """
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

    with session_factory() as session:
        total_dispatched = 0

        while True:
            due_schedules = _fetch_due_schedules(session)

            if not due_schedules:
                break

            with current_app.producer_or_acquire() as producer:  # type: ignore
                dispatched_count = _process_schedules(session, due_schedules, producer)
                total_dispatched += dispatched_count

                logger.debug("Batch processed: %d dispatched", dispatched_count)

                # Circuit breaker: check if we've hit the per-tick limit (if enabled)
                if 0 < dify_config.WORKFLOW_SCHEDULE_MAX_DISPATCH_PER_TICK <= total_dispatched:
                    logger.warning(
                        "Circuit breaker activated: reached dispatch limit (%d), will continue next tick",
                        dify_config.WORKFLOW_SCHEDULE_MAX_DISPATCH_PER_TICK,
                    )
                    break
        if total_dispatched > 0:
            logger.info("Total processed: %d workflow schedule(s) dispatched", total_dispatched)


def _fetch_due_schedules(session: Session) -> list[WorkflowSchedulePlan]:
    """
    Fetch a batch of due schedules, sorted by most overdue first.

    Returns up to WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE schedules per call.
    Used in a loop to progressively process all due schedules.
    """
    now = naive_utc_now()

    due_schedules = session.scalars(
        (
            select(WorkflowSchedulePlan)
            .join(
                AppTrigger,
                and_(
                    AppTrigger.app_id == WorkflowSchedulePlan.app_id,
                    AppTrigger.node_id == WorkflowSchedulePlan.node_id,
                    AppTrigger.trigger_type == AppTriggerType.TRIGGER_SCHEDULE,
                ),
            )
            .where(
                WorkflowSchedulePlan.next_run_at <= now,
                WorkflowSchedulePlan.next_run_at.isnot(None),
                AppTrigger.status == AppTriggerStatus.ENABLED,
            )
        )
        .order_by(WorkflowSchedulePlan.next_run_at.asc())
        .with_for_update(skip_locked=True)
        .limit(dify_config.WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE)
    )

    return list(due_schedules)


def _process_schedules(session: Session, schedules: list[WorkflowSchedulePlan], producer=None) -> int:
    """Process schedules: check quota, update next run time and dispatch to Celery in parallel."""
    if not schedules:
        return 0

    tasks_to_dispatch: list[str] = []
    for schedule in schedules:
        next_run_at = calculate_next_run_at(
            schedule.cron_expression,
            schedule.timezone,
        )
        schedule.next_run_at = next_run_at

        tasks_to_dispatch.append(schedule.id)

    with _dispatch_result_backend():
        job = group(run_schedule_trigger.s(schedule_id) for schedule_id in tasks_to_dispatch)
        job.apply_async(producer=producer, add_to_parent=False)
        # 先提交定时计划、释放行锁，再等待结果消费者停止。
        session.commit()

    logger.debug("Dispatched %d tasks in parallel", len(tasks_to_dispatch))

    return len(tasks_to_dispatch)


@contextmanager
def _dispatch_result_backend() -> Generator[None]:
    """为每批只派发、不等待结果的 group 管理独立 Redis 结果消费者。

    Celery 的 gevent drainer 会在轮询结束后继续持有协程局部 backend。
    只清理本批独占的 backend，不断开进程共享 backend 或 broker 连接池。
    """
    # Celery 的存根把 current_app 标为应用实例，运行时实际是代理。
    app = cast(Any, current_app)._get_current_object()
    if app._backend_cache is not None:
        # 显式共享的 backend 也属于其他并发任务，不能在这里关闭。
        yield
        return

    backend_class, _ = backends.by_url(app.backend_cls or app.conf.result_backend, app.loader)
    if not issubclass(backend_class, RedisBackend):
        yield
        return

    previous_backend = app._backend
    backend = app._get_backend()
    app._local.backend = backend
    try:
        yield
    finally:
        consumer = backend.result_consumer
        try:
            try:
                # 未启动的 gevent drainer 不能调用 stop，否则会一直等待退出事件。
                drainer = consumer.drainer
                if isinstance(drainer, geventDrainer) and drainer._g is not None:
                    from gevent import with_timeout

                    drainer_greenlet = drainer._g
                    try:
                        with_timeout(2, drainer.stop, timeout_value=None)
                    finally:
                        if not drainer_greenlet.dead:
                            drainer_greenlet.kill(block=True, timeout=1)
            finally:
                try:
                    # 关闭独占 PubSub 会在本地清理所有订阅；显式 UNSUBSCRIBE
                    # 可能在 Redis 故障时触发重连，因此不再发送该命令。
                    consumer.stop()
                finally:
                    # 防止 AsyncResult 延迟析构时重新打开已关闭的 PubSub。
                    consumer._pubsub = None
                    consumer.subscribed_to.clear()
                    for pending in backend._pending_results:
                        pending.clear()
                    # PubSub.close() 会断开订阅连接；再断开独占池中的其余连接。
                    client = backend.__dict__.get("client")
                    if client is not None:
                        client.connection_pool.disconnect()
        except Exception:
            # 已派发任务不能因清理失败而丢失定时计划提交；记录错误，
            # 不覆盖原始派发异常。
            logger.exception("Failed to close schedule dispatch Redis result backend")
        finally:
            app._local.backend = previous_backend
