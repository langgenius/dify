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
    while True:
        try:
            # check the number of idle tidb serverless
            tidb_serverless_list = TidbAuthBinding.query.filter(
                TidbAuthBinding.active == False, TidbAuthBinding.status == "CREATING"
            ).all()
            if len(tidb_serverless_list) == 0:
                break
            # update tidb serverless status
            iterations_per_thread = 20
            update_clusters(tidb_serverless_list)

        except Exception as e:
            click.echo(click.style(f"Error: {e}", fg="red"))
            break

    end_at = time.perf_counter()
    click.echo(
        click.style("Update tidb serverless status task success latency: {}".format(end_at - start_at), fg="green")
    )


def update_clusters(tidb_serverless_list: list[TidbAuthBinding]):
    try:
        # batch 20
        for i in range(0, len(tidb_serverless_list), 20):
            items = tidb_serverless_list[i : i + 20]
            TidbService.batch_update_tidb_serverless_cluster_status(
                items,
                dify_config.TIDB_PROJECT_ID,
                dify_config.TIDB_API_URL,
                dify_config.TIDB_IAM_API_URL,
                dify_config.TIDB_PUBLIC_KEY,
                dify_config.TIDB_PRIVATE_KEY,
            )
    except Exception as e:
        click.echo(click.style(f"Error: {e}", fg="red"))
