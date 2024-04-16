import sys, os
sys.path.append(os.getcwd())

from waitress import serve
from app import app

import logging

class IgnoreBlockingIOErrorFilter(logging.Filter):
    def filter(self, record):
        if record.exc_info:
            exc_type, exc_value = record.exc_info[:2]
            if isinstance(exc_value, BlockingIOError) and exc_value.errno == 10035:
                return False
        return True

logger = logging.getLogger('waitress')
logger.addFilter(IgnoreBlockingIOErrorFilter())

serve(app, host='0.0.0.0', port=5001, threads=6)
