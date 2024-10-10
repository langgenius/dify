def apply_gevent_threading_patch():
    """
    Run threading patch by gevent
    to make standard library threading compatible.
    Patching should be done as early as possible in the lifecycle of the program.
    :return:
    """
    # gevent
    from gevent import monkey

    monkey.patch_all()

    # grpc gevent
    from grpc.experimental import gevent as grpc_gevent

    grpc_gevent.init_gevent()
