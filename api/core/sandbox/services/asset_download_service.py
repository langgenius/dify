"""Shell script builder for downloading / writing assets into a sandbox VM.

Generates a self-contained POSIX shell script that handles two kinds of
``SandboxDownloadItem``:

- Items with *content* — written via base64 heredoc (sequential).
- Items with *url* — fetched via ``curl``/``wget``/``python3`` with
  auto-detection, run as parallel background jobs.

Both kinds can be mixed freely in a single call.
"""

from __future__ import annotations

import base64
import shlex
import textwrap
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.zip_sandbox.entities import SandboxDownloadItem


def _build_inline_commands(items: list[SandboxDownloadItem], root_var: str) -> str:
    """Generate shell commands that write base64-encoded content to files."""
    lines: list[str] = []
    for idx, item in enumerate(items):
        assert item.content is not None
        dest = f"${{{root_var}}}/{shlex.quote(item.path)}"
        encoded = base64.b64encode(item.content).decode("ascii")
        lines.append(f'mkdir -p "$(dirname "{dest}")"')
        lines.append(f"base64 -d <<'_INLINE_{idx}' > \"{dest}\"")
        lines.append(encoded)
        lines.append(f"_INLINE_{idx}")
    return "\n".join(lines)


def _render_download_script(
    root_path: str,
    inline_commands: str,
    download_commands: str,
    need_downloader: bool,
) -> str:
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

    # Only emit the downloader-detection block when there are remote items.
    if need_downloader:
        downloader_block = f"""\
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

fail_log="$(mktemp)"

download_one() {{
  file_path="$1"
  url="$2"
  dest="${{download_root}}/${{file_path}}"
  mkdir -p "$(dirname "${{dest}}")"
  eval "${{download_cmd}}" 2>/dev/null || echo "${{file_path}}" >> "${{fail_log}}"
}}"""
    else:
        downloader_block = ""

    # The failure-check block is only meaningful when downloads occurred.
    if need_downloader:
        wait_block = textwrap.dedent("""\
            wait

            if [ -s "${fail_log}" ]; then
              mv "${fail_log}" "${download_root}/DOWNLOAD_FAILURES.txt"
            else
              rm -f "${fail_log}"
            fi""")
    else:
        wait_block = ""

    script = f"""\
download_root={shlex.quote(root_path)}
mkdir -p "${{download_root}}"

{downloader_block}

{inline_commands}

{download_commands}

{wait_block}
exit 0"""
    return script


class AssetDownloadService:
    @staticmethod
    def build_download_script(
        items: list[SandboxDownloadItem],
        root_path: str,
    ) -> str:
        """Build a portable shell script to write inline assets and download remote ones.

        Items with *content* are written first (sequential base64 decode),
        then items with *url* are fetched in parallel background jobs.
        The two kinds can be mixed freely in a single list.
        """
        inline = [item for item in items if item.content is not None]
        remote = [item for item in items if item.content is None]

        inline_commands = _build_inline_commands(inline, "download_root") if inline else ""

        commands: list[str] = []
        for item in remote:
            path = shlex.quote(item.path)
            url = shlex.quote(item.url)
            commands.append(f"download_one {path} {url} &")
        download_commands = "\n".join(commands)

        return _render_download_script(
            root_path,
            inline_commands,
            download_commands,
            need_downloader=bool(remote),
        )
