import time

import app
import click

# Import other necessary modules


@app.celery.task(queue="dataset")
def user_memory_generate_task():
    click.echo(click.style("Starting user memory generate task.", fg="green"))
    start_at = time.perf_counter()

    # Your task logic here
    # ...
    click.echo(click.style("TODO: ytqh user memory generate task.", fg="green"))

    end_at = time.perf_counter()
    click.echo(click.style(f"Task completed successfully. Latency: {end_at - start_at}", fg="green"))
