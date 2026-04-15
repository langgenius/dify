import time
from collections.abc import Sequence

import click
from dify_vdb_tidb_on_qdrant.tidb_service import TidbService
from sqlalchemy import select

import app
from configs import dify_config
from core.db.session_factory import session_factory
from models.dataset import TidbAuthBinding
from models.enums import TidbAuthBindingStatus


@app.celery.task(queue="dataset")
def update_tidb_serverless_status_task():
    click.echo(click.style("Update tidb serverless status task.", fg="green"))
    start_at = time.perf_counter()
    try:
        # Narrow session to the read query; release the connection before the
        # external TiDB API call so we don't hold it open during network I/O.
        with session_factory.create_session() as session:
            tidb_serverless_list = session.scalars(
                select(TidbAuthBinding).where(
                    TidbAuthBinding.active == False,
                    TidbAuthBinding.status == TidbAuthBindingStatus.CREATING,
                )
            ).all()
            # Detach so column attributes remain accessible after session closes.
            for item in tidb_serverless_list:
                session.expunge(item)
        if len(tidb_serverless_list) == 0:
            return
        # update tidb serverless status after the read session is closed
        update_clusters(tidb_serverless_list)

    except Exception as e:
        click.echo(click.style(f"Error: {e}", fg="red"))

    end_at = time.perf_counter()
    click.echo(click.style(f"Update tidb serverless status task success latency: {end_at - start_at}", fg="green"))


def update_clusters(tidb_serverless_list: Sequence[TidbAuthBinding]):
    try:
        # batch 20
        for i in range(0, len(tidb_serverless_list), 20):
            items = tidb_serverless_list[i : i + 20]
            # TODO: maybe we can set the default value for the following parameters in the config file
            TidbService.batch_update_tidb_serverless_cluster_status(
                tidb_serverless_list=items,
                project_id=dify_config.TIDB_PROJECT_ID or "",
                api_url=dify_config.TIDB_API_URL or "",
                iam_url=dify_config.TIDB_IAM_API_URL or "",
                public_key=dify_config.TIDB_PUBLIC_KEY or "",
                private_key=dify_config.TIDB_PRIVATE_KEY or "",
            )
    except Exception as e:
        click.echo(click.style(f"Error: {e}", fg="red"))
