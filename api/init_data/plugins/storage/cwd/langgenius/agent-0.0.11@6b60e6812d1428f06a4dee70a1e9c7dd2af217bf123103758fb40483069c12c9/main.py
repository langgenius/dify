import sys

sys.path.append("../..")

from dify_plugin import DifyPluginEnv, Plugin

plugin = Plugin(DifyPluginEnv(MAX_REQUEST_TIMEOUT=240))

if __name__ == "__main__":
    plugin.run()
