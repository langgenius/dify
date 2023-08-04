import logging
import time

import click
import requests
from celery import shared_task

from core.generator.llm_generator import LLMGenerator


@shared_task
def generate_test_task():
    logging.info(click.style('Start generate test', fg='green'))
    start_at = time.perf_counter()

    try:
        #res = requests.post('https://api.openai.com/v1/chat/completions')
        answer = LLMGenerator.generate_conversation_name('84b2202c-c359-46b7-a810-bce50feaa4d1', 'avb', 'ccc')
        print(f'answer: {answer}')

        end_at = time.perf_counter()
        logging.info(click.style('Conversation test, latency: {}'.format(end_at - start_at), fg='green'))
    except Exception:
        logging.exception("generate test failed")
