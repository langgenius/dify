from _dify_gevent_bootstrap import gevent_compat


def test_apply_gevent_third_party_patches_applies_compatibility_patches_once(mocker):
    init_gevent = mocker.patch("grpc.experimental.gevent.init_gevent")
    patch_psycopg = mocker.patch("psycogreen.gevent.patch_psycopg")
    print_mock = mocker.patch("builtins.print")
    mocker.patch.object(gevent_compat, "_third_party_modules_patched", False)

    gevent_compat.apply_gevent_third_party_patches()
    gevent_compat.apply_gevent_third_party_patches()

    init_gevent.assert_called_once_with()
    patch_psycopg.assert_called_once_with()
    assert print_mock.call_count == 2


def test_apply_gevent_third_party_patches_returns_when_already_applied(mocker):
    init_gevent = mocker.patch("grpc.experimental.gevent.init_gevent")
    patch_psycopg = mocker.patch("psycogreen.gevent.patch_psycopg")
    print_mock = mocker.patch("builtins.print")
    mocker.patch.object(gevent_compat, "_third_party_modules_patched", True)

    gevent_compat.apply_gevent_third_party_patches()

    init_gevent.assert_not_called()
    patch_psycopg.assert_not_called()
    print_mock.assert_not_called()


def test_require_gevent_monkey_patched_raises_when_required_modules_are_missing(mocker):
    monkey = mocker.Mock()
    monkey.is_module_patched.side_effect = lambda module: module == "socket"
    mocker.patch("gevent.monkey", monkey)
    print_mock = mocker.patch("builtins.print")

    try:
        gevent_compat.require_gevent_monkey_patched("test entrypoint")
    except SystemExit as exc:
        assert exc.code == 1
    else:
        raise AssertionError("Expected SystemExit when gevent monkey patching is incomplete")

    print_mock.assert_called_once()
    assert "test entrypoint" in print_mock.call_args.args[0]
    assert "threading, queue" in print_mock.call_args.args[0]


def test_is_celery_gevent_worker_process_detects_gevent_worker_cli():
    assert gevent_compat.is_celery_gevent_worker_process(["celery", "worker", "-P", "gevent"])
    assert gevent_compat.is_celery_gevent_worker_process(["celery", "worker", "--pool=gevent"])
    assert not gevent_compat.is_celery_gevent_worker_process(["celery", "worker", "-P", "solo"])
    assert not gevent_compat.is_celery_gevent_worker_process(["celery", "beat"])
