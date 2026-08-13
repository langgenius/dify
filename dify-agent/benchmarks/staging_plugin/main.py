# pyright: reportMissingImports=false

from dify_plugin import DifyPluginEnv, Plugin


plugin = Plugin(DifyPluginEnv())


if __name__ == "__main__":
    plugin.run()
