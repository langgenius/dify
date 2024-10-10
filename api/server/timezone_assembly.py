import os
import time

from flask import Flask

from server.basic_assembly import BasicAssembly


class TimezoneAssembly(BasicAssembly):
    def prepare_app(self, app: Flask):
        prepare_timezone()


def prepare_timezone():
    os.environ["TZ"] = "UTC"
    # windows platform not support tzset
    if hasattr(time, "tzset"):
        time.tzset()
