from flask import Flask

from commands import register_commands
from server.basic_assembly import BasicAssembly


class CommandsAssembly(BasicAssembly):
    def prepare_app(self, app: Flask):
        register_commands(app)
