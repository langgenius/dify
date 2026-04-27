def test_local_events_exports_compat_events_class():
    import events

    evt = events.Events()
    called = []

    evt.request_start += lambda *args, **kwargs: called.append((args, kwargs))
    evt.request_start("GET", "/_search")

    assert len(called) == 1


def test_opensearch_import_works_with_local_events_package():
    from opensearchpy import OpenSearch

    assert OpenSearch is not None
