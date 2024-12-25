import time

import click

import app
from configs import dify_config
from core.rag.datasource.vdb.tidb_on_qdrant.tidb_service import TidbService
from models.dataset import TidbAuthBinding


@app.celery.task(queue="dataset")
def update_tidb_serverless_status_task():
    click.echo(click.style("Update tidb serverless status task.", fg="green"))
    start_at = time.perf_counter()
    try:
        # check the number of idle tidb serverless
        tidb_serverless_list = TidbAuthBinding.query.filter(
            TidbAuthBinding.active == False, TidbAuthBinding.status == "CREATING"
        ).all()
        if len(tidb_serverless_list) == 0:
            return
        # update tidb serverless status
        update_clusters(tidb_serverless_list)

    except Exception as e:
        click.echo(click.style(f"Error: {e}", fg="red"))

    end_at = time.perf_counter()
    click.echo(
        click.style("Update tidb serverless status task success latency: {}".format(end_at - start_at), fg="green")
    )


def update_clusters(tidb_serverless_list: list[TidbAuthBinding]):
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
