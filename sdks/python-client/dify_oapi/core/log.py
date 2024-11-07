import logging
import sys

logger = logging.getLogger("Dify")
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(
    logging.Formatter("[Dify] [%(asctime)s] [%(levelname)s] %(message)s")
)
logger.addHandler(handler)
logger.setLevel(logging.WARNING)
