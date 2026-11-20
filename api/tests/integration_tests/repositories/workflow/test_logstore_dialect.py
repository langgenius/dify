"""Read-only SLS dialect checks against a configured CI LogStore project.

The project must already contain the workflow node execution LogStore and indexes.
These queries use a unique absent owner, so no customer records or writes are needed.
"""

from collections.abc import Iterator
from uuid import uuid4

import pytest

from configs import dify_config
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.aliyun_logstore_pg import AliyunLogStorePG
from repositories.workflow.logstore.queries import latest_records, node_execution_page
from repositories.workflow.logstore.schema import WORKFLOW_NODE_EXECUTION_LOGSTORE


@pytest.fixture(params=[False, True], ids=["sdk", "pg"])
def logstore(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> Iterator[AliyunLogStore]:
    if not all(
        (
            dify_config.ALIYUN_SLS_ACCESS_KEY_ID,
            dify_config.ALIYUN_SLS_ACCESS_KEY_SECRET,
            dify_config.ALIYUN_SLS_ENDPOINT,
            dify_config.ALIYUN_SLS_REGION,
            dify_config.ALIYUN_SLS_PROJECT_NAME,
        )
    ):
        pytest.skip("SLS dialect integration requires a configured CI LogStore project")
    monkeypatch.setattr(AliyunLogStore, "_instance", None)
    monkeypatch.setattr(AliyunLogStore, "_initialized", False)
    monkeypatch.setattr(dify_config, "LOGSTORE_PG_MODE_ENABLED", request.param)
    client = AliyunLogStore()
    try:
        if request.param:
            # Connect to the existing project without invoking startup's
            # project/logstore/index creation and upgrade operations.
            client._logstore_names = (WORKFLOW_NODE_EXECUTION_LOGSTORE,)
            client._pg_client = AliyunLogStorePG(
                client.access_key_id, client.access_key_secret, client.endpoint, client.project_name
            )
            client._attempt_pg_connection_init()
        assert client._use_pg_protocol is request.param, "Requested PG transport must not silently fall back to SDK"
        yield client
    finally:
        if client._pg_client is not None:
            client._pg_client.close()


@pytest.mark.parametrize("offset", [0, 1000])
@pytest.mark.parametrize("include_paused", [True, False], ids=["details-and-snapshots", "runtime-history"])
def test_node_pagination_is_accepted_by_sls(logstore: AliyunLogStore, offset: int, include_paused: bool) -> None:
    current = latest_records(
        WORKFLOW_NODE_EXECUTION_LOGSTORE,
        {"tenant_id": str(uuid4()), "app_id": str(uuid4()), "workflow_run_id": str(uuid4())},
    )
    sql = node_execution_page(
        current,
        order_by=["created_at ASC", '"index" ASC', "id ASC"],
        include_paused=include_paused,
        offset=offset,
        count=1000,
    )

    assert logstore.execute_sql(sql=sql, logstore=WORKFLOW_NODE_EXECUTION_LOGSTORE) == []
