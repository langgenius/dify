# Copyright (c) OpenMMLab. All rights reserved.
from typing import Tuple

__version__ = '0.1.0'
short_version = __version__


def parse_version_info(version_str: str) -> Tuple:
    """Parse version from a string.

    Args:
        version_str (str): A string represents a version info.

    Returns:
        tuple: A sequence of integer and string represents version.
    """
    _version_info = []
    for x in version_str.split('.'):
        if x.isdigit():
            _version_info.append(int(x))
        elif x.find('rc') != -1:
            patch_version = x.split('rc')
            _version_info.append(int(patch_version[0]))
            _version_info.append(f'rc{patch_version[1]}')
    return tuple(_version_info)


version_info = parse_version_info(__version__)