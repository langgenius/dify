import threading
from time import sleep, ctime
from typing import List

from celery import shared_task




@shared_task
def test_task():
    """
    Clean dataset when dataset deleted.

    Usage: test_task.delay(dataset_id, tenant_id, indexing_technique, index_struct)
    """
    print('---开始---:%s' % ctime())

    def smoke(count: List):
        for i in range(3):
            print("smoke...%d" % i)
            count.append("smoke...%d" % i)
            sleep(1)

    def drunk(count: List):
        for i in range(3):
            print("drink...%d" % i)
            count.append("drink...%d" % i)
            sleep(10)
    count = []
    threads = []
    for i in range(3):
        t1 = threading.Thread(target=smoke, kwargs={'count': count})
        t2 = threading.Thread(target=drunk, kwargs={'count': count})
        threads.append(t1)
        threads.append(t2)
        t1.start()
        t2.start()
    for thread in threads:
        thread.join()
    print(str(count))
    # sleep(5) #
    print('---结束---:%s' % ctime())