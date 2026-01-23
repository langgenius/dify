from __future__ import annotations

import shlex
import textwrap
from dataclasses import dataclass


def _render_download_script(root_path: str, download_commands: str) -> str:
    python_download_cmd = (
        'python3 - "${url}" "${dest}" <<"PY"\n'
        "import sys\n"
        "import urllib.request\n"
        "url = sys.argv[1]\n"
        "dest = sys.argv[2]\n"
        "with urllib.request.urlopen(url) as resp:\n"
        "    data = resp.read()\n"
        'with open(dest, "wb") as f:\n'
        "    f.write(data)\n"
        "PY"
    )
    script = f"""
    download_root={shlex.quote(root_path)}

    if command -v curl >/dev/null 2>&1; then
      download_cmd='curl -fsSL "${{url}}" -o "${{dest}}"'
    elif command -v wget >/dev/null 2>&1; then
      download_cmd='wget -q "${{url}}" -O "${{dest}}"'
    elif command -v python3 >/dev/null 2>&1; then
      download_cmd={shlex.quote(python_download_cmd)}
    else
      echo 'No downloader found (curl/wget/python3)' >&2
      exit 1
    fi

    mkdir -p "${{download_root}}"
    fail_log="$(mktemp)"

    download_one() {{
      file_path="$1"
      url="$2"
      dest="${{download_root}}/${{file_path}}"
      mkdir -p "$(dirname "${{dest}}")"
      eval "${{download_cmd}}" || echo "${{file_path}}" >> "${{fail_log}}"
    }}

    {download_commands}

    wait

    if [ -s "${{fail_log}}" ]; then
      mv "${{fail_log}}" "${{download_root}}/DOWNLOAD_FAILURES.txt"
    else
      rm -f "${{fail_log}}"
    fi
    """
    return textwrap.dedent(script).strip()


@dataclass(frozen=True)
class AssetDownloadItem:
    path: str
    url: str


class AssetDownloadService:
    @staticmethod
    def build_download_script(items: list[AssetDownloadItem], root_path: str) -> str:
        # Build a portable shell script to download assets in parallel.
        commands: list[str] = []
        for item in items:
            path = shlex.quote(item.path)
            url = shlex.quote(item.url)
            commands.append(f"download_one {path} {url} &")
        download_commands = "\n".join(commands)
        return _render_download_script(root_path, download_commands)
