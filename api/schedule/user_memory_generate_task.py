import time

import app
import click
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import App, EndUser
from services.app_generate_service import AppGenerateService


@app.celery.task(queue="dataset")
def user_memory_generate_task():
    click.echo(click.style("Starting user memory generate task.", fg="green"))
    start_at = time.perf_counter()

    # Your task logic here
    # ...
    click.echo(click.style("TODO: ytqh user memory generate task.", fg="green"))

    # TODO: ytqh call user memory workflow api
    ## API KEY: app-4UVXs1hBgEWxzp5Zvh5FINbv
    ## TASK ID: 760d9bef-20ee-4fa3-8650-ca300e292b32

    # get app model by using TASK ID
    app_model = App.query.filter(App.id == "760d9bef-20ee-4fa3-8650-ca300e292b32").first()
    # get end user by using app model
    end_user = EndUser.query.filter(EndUser.external_user_id == "81f30432-fa3f-4279-a6c9-8b61c874699a").first()

    args = {
        "inputs": {
            "new_messages": "sssss",
            "current_memory": "sssss",
        }
    }

    response = AppGenerateService.generate(
        app_model=app_model, user=end_user, args=args, invoke_from=InvokeFrom.SCHEDULER, streaming=False
    )

    # save response to db
    click.echo(click.style(f"TODO: ytqh save response {response} to db.", fg="green"))

    end_at = time.perf_counter()
    click.echo(click.style(f"Task completed successfully. Latency: {end_at - start_at}", fg="green"))
