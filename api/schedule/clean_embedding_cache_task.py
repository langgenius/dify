import logging

import click

import app


@app.celery.task(queue='dataset')
def my_periodic_task():
    logging.info(click.style('Start clean dataset when dataset deleted: {}'.format("asdadsad"), fg='green'))
    print("Running my periodic task!")
