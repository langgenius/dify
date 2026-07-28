import psycogreen.gevent as pscycogreen_gevent
from gevent import events as gevent_events
from grpc.experimental import gevent as grpc_gevent

# WARNING: This module is loaded very early in the Gunicorn worker lifecycle,
# before gevent's monkey-patching is applied. Importing modules at the top level here can
# interfere with gevent's ability to properly patch the standard library,
# potentially causing subtle and difficult-to-diagnose bugs.
#
# To ensure correct behavior, defer any initialization or imports that depend on monkey-patching
# to the `post_patch` hook below, or use a gevent_events subscriber as shown.
#
# For further context, see: https://github.com/langgenius/dify/issues/26689
#
# Note: The `post_fork` hook is also executed before monkey-patching,
# so moving imports there does not resolve this issue.

# NOTE(QuantumGhost): here we cannot use post_fork to patch gRPC, as
# grpc_gevent.init_gevent must be called after patching stdlib.
# Gunicorn calls `post_init` before applying monkey patch.
# Use `post_init` to setup gRPC gevent support would cause deadlock and
# some other weird issues.
#
# ref:
# - https://github.com/grpc/grpc/blob/62533ea13879d6ee95c6fda11ec0826ca822c9dd/src/python/grpcio/grpc/experimental/gevent.py
# - https://github.com/gevent/gevent/issues/2060#issuecomment-3016768668
# - https://github.com/benoitc/gunicorn/blob/23.0.0/gunicorn/arbiter.py#L605-L609


def post_patch(event):
    # this function is only called for gevent worker.
    # from gevent docs (https://www.gevent.org/api/gevent.monkey.html):
    # You can also subscribe to the events to provide additional patching beyond what gevent distributes, either for
    # additional standard library modules, or for third-party packages. The suggested time to do this patching is in
    # the subscriber for gevent.events.GeventDidPatchBuiltinModulesEvent.
    if not isinstance(event, gevent_events.GeventDidPatchBuiltinModulesEvent):
        return
    # grpc gevent
    grpc_gevent.init_gevent()
    print("gRPC patched with gevent.", flush=True)  # noqa: T201
    pscycogreen_gevent.patch_psycopg()
    print("psycopg2 patched with gevent.", flush=True)  # noqa: T201


gevent_events.subscribers.append(post_patch)


def post_worker_init(worker):
    """Install workflow draining before Gunicorn's normal SIGTERM handling."""
    # Import lazily: this hook runs after the gevent worker has applied stdlib
    # monkey-patching, while this configuration module itself is imported much
    # earlier in the worker lifecycle.
    import signal

    from configs import dify_config
    from extensions.workflow_warm_shutdown import begin_workflow_warm_shutdown

    # Keep a dormant rollout behaviorally identical to the previous release.
    # Celery retains its historical warm-shutdown abort fallback, but Gunicorn
    # already waits for in-flight requests and must not inject an AbortCommand
    # unless durable handoff is explicitly enabled.
    if not dify_config.WORKFLOW_HANDOFF_ENABLED:
        return

    original_sigterm_handler = signal.getsignal(signal.SIGTERM)
    if not callable(original_sigterm_handler):
        raise RuntimeError("Gunicorn SIGTERM handler is not installed before post_worker_init")

    def handle_workflow_warm_shutdown(signum, frame):
        try:
            begin_workflow_warm_shutdown(source="Gunicorn API worker")
        except Exception:
            worker.log.exception("Failed to start workflow draining during Gunicorn SIGTERM")
        finally:
            original_sigterm_handler(signum, frame)

    signal.signal(signal.SIGTERM, handle_workflow_warm_shutdown)
    # ``signal.signal`` can restore interruptible syscalls. Preserve Gunicorn's
    # behavior so SIGTERM does not interrupt an in-flight API request mid-I/O.
    signal.siginterrupt(signal.SIGTERM, False)
