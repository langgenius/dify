from libs import gevent_compat


def test_apply_gevent_third_party_patches_applies_compatibility_patches_once(mocker):
    init_gevent = mocker.patch("grpc.experimental.gevent.init_gevent")
    patch_psycopg = mocker.patch("psycogreen.gevent.patch_psycopg")
    print_mock = mocker.patch("builtins.print")
    mocker.patch.object(gevent_compat, "_patches_applied", False)

    gevent_compat.apply_gevent_third_party_patches()
    gevent_compat.apply_gevent_third_party_patches()

    init_gevent.assert_called_once_with()
    patch_psycopg.assert_called_once_with()
    assert print_mock.call_count == 2


def test_apply_gevent_third_party_patches_returns_when_already_applied(mocker):
    init_gevent = mocker.patch("grpc.experimental.gevent.init_gevent")
    patch_psycopg = mocker.patch("psycogreen.gevent.patch_psycopg")
    print_mock = mocker.patch("builtins.print")
    mocker.patch.object(gevent_compat, "_patches_applied", True)

    gevent_compat.apply_gevent_third_party_patches()

    init_gevent.assert_not_called()
    patch_psycopg.assert_not_called()
    print_mock.assert_not_called()
