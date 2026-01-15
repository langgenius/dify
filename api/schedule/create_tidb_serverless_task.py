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
    if not dify_config.CREATE_TIDB_SERVICE_JOB_ENABLED:
        return
    tidb_serverless_number = dify_config.TIDB_SERVERLESS_NUMBER
    start_at = time.perf_counter()
    while True:
        try:
            # check the number of idle tidb serverless
            idle_tidb_serverless_number = (
                db.session.query(TidbAuthBinding).where(TidbAuthBinding.active == False).count()
            )
            if idle_tidb_serverless_number >= tidb_serverless_number:
                break
            # create tidb serverless
            iterations_per_thread = 20
            create_clusters(iterations_per_thread)

        except Exception as e:
            click.echo(click.style(f"Error: {e}", fg="red"))
            break

    end_at = time.perf_counter()
    click.echo(click.style(f"Create tidb serverless task success latency: {end_at - start_at}", fg="green"))


def create_clusters(batch_size):
    try:
        # TODO: maybe we can set the default value for the following parameters in the config file
        new_clusters = TidbService.batch_create_tidb_serverless_cluster(
            batch_size=batch_size,
            project_id=dify_config.TIDB_PROJECT_ID or "",
            api_url=dify_config.TIDB_API_URL or "",
            iam_url=dify_config.TIDB_IAM_API_URL or "",
            public_key=dify_config.TIDB_PUBLIC_KEY or "",
            private_key=dify_config.TIDB_PRIVATE_KEY or "",
            region=dify_config.TIDB_REGION or "",
        )
        for new_cluster in new_clusters:
            tidb_auth_binding = TidbAuthBinding(
                tenant_id=None,
                cluster_id=new_cluster["cluster_id"],
                cluster_name=new_cluster["cluster_name"],
                account=new_cluster["account"],
                password=new_cluster["password"],
                active=False,
                status="CREATING",
            )
            db.session.add(tidb_auth_binding)
        db.session.commit()
    except Exception as e:
        click.echo(click.style(f"Error: {e}", fg="red"))
