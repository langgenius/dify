import logging
import time

import pymysql

logger = logging.getLogger(__name__)


def check_tiflash_ready() -> bool:
    connection = None
    try:
        connection = pymysql.connect(
            host="localhost",
            port=4000,
            user="root",
            password="",
        )

        with connection.cursor() as cursor:
            # Doc reference:
            # https://docs.pingcap.com/zh/tidb/stable/information-schema-cluster-hardware
            select_tiflash_query = """
            SELECT * FROM information_schema.cluster_hardware
            WHERE TYPE='tiflash'
            LIMIT 1;
            """
            cursor.execute(select_tiflash_query)
            result = cursor.fetchall()
            return result is not None and len(result) > 0
    except Exception:
        logger.exception("TiFlash is not ready.")
        return False
    finally:
        if connection:
            connection.close()


def main():
    max_attempts = 30
    retry_interval_seconds = 2
    is_tiflash_ready = False
    for attempt in range(max_attempts):
        try:
            is_tiflash_ready = check_tiflash_ready()
        except Exception:
            logger.exception("TiFlash is not ready.")
            is_tiflash_ready = False

        if is_tiflash_ready:
            break
        else:
            logger.error("Attempt %s failed, retry in %s seconds...", attempt + 1, retry_interval_seconds)
            time.sleep(retry_interval_seconds)

    if is_tiflash_ready:
        logger.info("TiFlash is ready in TiDB.")
    else:
        logger.error("TiFlash is not ready in TiDB after %s attempting checks.", max_attempts)
        exit(1)


if __name__ == "__main__":
    main()
