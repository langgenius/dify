from flask import Flask

from server.basic_assembly import BasicAssembly


class PreloadModuleAssembly(BasicAssembly):
    def prepare_app(self, app: Flask):
        preload_modules()


def preload_modules():
    from events import event_handlers  # noqa: F401
    from models import account, dataset, model, source, task, tool, tools, web  # noqa: F401
