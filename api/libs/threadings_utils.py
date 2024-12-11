from configs import dify_config


def apply_gevent_threading_patch():
    """
    Run threading patch by gevent
    to make standard library threading compatible.
    Patching should be done as early as possible in the lifecycle of the program.
    :return:
    """
    if not dify_config.DEBUG:
        from gevent import monkey
        from grpc.experimental import gevent as grpc_gevent

        # gevent
        monkey.patch_all()

        # grpc gevent
        grpc_gevent.init_gevent()
