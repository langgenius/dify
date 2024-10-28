import time

import click

import app
from configs import dify_config
from core.rag.datasource.vdb.tidb_on_qdrant.tidb_service import TidbService
from extensions.ext_database import db
from models.dataset import TidbAuthBinding


@app.celery.task(queue="dataset")
def create_tidb_serverless_task():
    click.echo(click.style("Start create tidb serverless task.", fg="green"))
    tidb_serverless_number = dify_config.TIDB_SERVERLESS_NUMBER
    start_at = time.perf_counter()
    while True:
        try:
            # check the number of idle tidb serverless
            idle_tidb_serverless_number = TidbAuthBinding.query.filter(TidbAuthBinding.active == False).count()
            if idle_tidb_serverless_number >= tidb_serverless_number:
                break
            # create tidb serverless
            iterations_per_thread = 20
            create_clusters(iterations_per_thread)

        except Exception as e:
            click.echo(click.style(f"Error: {e}", fg="red"))
            break

    end_at = time.perf_counter()
    click.echo(click.style("Create tidb serverless task success latency: {}".format(end_at - start_at), fg="green"))


def create_clusters(batch_size):
    try:
        new_clusters = TidbService.batch_create_tidb_serverless_cluster(
            batch_size,
            dify_config.TIDB_PROJECT_ID,
            dify_config.TIDB_API_URL,
            dify_config.TIDB_IAM_API_URL,
            dify_config.TIDB_PUBLIC_KEY,
            dify_config.TIDB_PRIVATE_KEY,
            dify_config.TIDB_REGION,
        )
        for new_cluster in new_clusters:
            tidb_auth_binding = TidbAuthBinding(
                cluster_id=new_cluster["cluster_id"],
                cluster_name=new_cluster["cluster_name"],
                account=new_cluster["account"],
                password=new_cluster["password"],
            )
            db.session.add(tidb_auth_binding)
        db.session.commit()
    except Exception as e:
        click.echo(click.style(f"Error: {e}", fg="red"))
