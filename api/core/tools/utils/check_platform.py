import platform
import re


class PlatformUtil:
    platform_name = platform.platform()

    @staticmethod
    def isMac() -> bool:
        return re.search(r"macOS", PlatformUtil.platform_name, re.IGNORECASE) is not None

    @staticmethod
    def isLinux() -> bool:
        return re.search(r"linux", PlatformUtil.platform_name, re.IGNORECASE) is not None
