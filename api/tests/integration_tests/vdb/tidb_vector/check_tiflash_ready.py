import time

import pymysql


def check_tiflash_ready() -> bool:
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
    except Exception as e:
        print(f"TiFlash is not ready. Exception: {e}")
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
        except Exception as e:
            print(f"TiFlash is not ready. Exception: {e}")
            is_tiflash_ready = False

        if is_tiflash_ready:
            break
        else:
            print(f"Attempt {attempt + 1} failed, retry in {retry_interval_seconds} seconds...")
            time.sleep(retry_interval_seconds)

    if is_tiflash_ready:
        print("TiFlash is ready in TiDB.")
    else:
        print(f"TiFlash is not ready in TiDB after {max_attempts} attempting checks.")
        exit(1)


if __name__ == "__main__":
    main()
