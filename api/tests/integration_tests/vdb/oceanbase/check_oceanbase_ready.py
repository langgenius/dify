import time

import pymysql


def check_oceanbase_ready() -> bool:
    try:
        connection = pymysql.connect(
            host="localhost",
            port=2881,
            user="root",
            password="difyai123456",
        )
        affected_rows = connection.query("SELECT 1")
        return affected_rows == 1
    except Exception as e:
        print(f"Oceanbase is not ready. Exception: {e}")
        return False
    finally:
        if connection:
            connection.close()


def main():
    max_attempts = 50
    retry_interval_seconds = 2
    is_oceanbase_ready = False
    for attempt in range(max_attempts):
        try:
            is_oceanbase_ready = check_oceanbase_ready()
        except Exception as e:
            print(f"Oceanbase is not ready. Exception: {e}")
            is_oceanbase_ready = False

        if is_oceanbase_ready:
            break
        else:
            print(f"Attempt {attempt + 1} failed, retry in {retry_interval_seconds} seconds...")
            time.sleep(retry_interval_seconds)

    if is_oceanbase_ready:
        print("Oceanbase is ready.")
    else:
        print(f"Oceanbase is not ready after {max_attempts} attempting checks.")
        exit(1)


if __name__ == "__main__":
    main()
