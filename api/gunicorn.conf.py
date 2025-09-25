import psycogreen.gevent as pscycogreen_gevent  # type: ignore
from grpc.experimental import gevent as grpc_gevent  # type: ignore


def post_fork(server, worker):
    # grpc gevent
    grpc_gevent.init_gevent()
    server.log.info("gRPC  patched with gevent.")
    pscycogreen_gevent.patch_psycopg()
    server.log.info("psycopg2 patched with gevent.")
