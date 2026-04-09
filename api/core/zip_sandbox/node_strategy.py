from __future__ import annotations

from typing import TYPE_CHECKING

from core.virtual_environment.__base.helpers import execute, try_execute

from .strategy import ZipStrategy

if TYPE_CHECKING:
    from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


ZIP_SCRIPT = r"""
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const src = process.argv[2];
const outPath = process.argv[3];

function walkAdd(zip, absPath, arcPrefix) {
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(absPath);
    if (entries.length === 0) {
      zip.addFile(arcPrefix.replace(/\\/g, '/') + '/', Buffer.alloc(0));
      return;
    }
    for (const e of entries) {
      walkAdd(zip, path.join(absPath, e), path.posix.join(arcPrefix, e));
    }
    return;
  }
  if (stat.isFile()) {
    const data = fs.readFileSync(absPath);
    zip.addFile(arcPrefix.replace(/\\/g, '/'), data);
  }
}

const zip = new AdmZip();
if (src === '.' || src === '') {
  const entries = fs.readdirSync('.');
  for (const e of entries) {
    walkAdd(zip, path.join('.', e), e);
  }
} else {
  const base = path.dirname(src) || '.';
  const prefix = path.basename(src.replace(/\/+$/, ''));
  const root = path.join(base, prefix);
  walkAdd(zip, root, prefix);
}

zip.writeZip(outPath);
"""

UNZIP_SCRIPT = r"""
const AdmZip = require('adm-zip');
const archivePath = process.argv[2];
const destDir = process.argv[3];
const zip = new AdmZip(archivePath);
zip.extractAllTo(destDir, true);
"""


class NodeZipStrategy(ZipStrategy):
    """Strategy using Node.js with adm-zip package."""

    def is_available(self, vm: VirtualEnvironment) -> bool:
        result = try_execute(vm, ["which", "node"], timeout=10)
        if not (result.stdout and result.stdout.strip()):
            return False
        # Check if adm-zip module is available
        result = try_execute(vm, ["node", "-e", "require('adm-zip')"], timeout=10)
        return not result.is_error

    def zip(
        self,
        vm: VirtualEnvironment,
        *,
        src: str,
        out_path: str,
        cwd: str | None,
        timeout: float,
    ) -> None:
        execute(
            vm,
            ["node", "-e", ZIP_SCRIPT, src, out_path],
            timeout=timeout,
            cwd=cwd,
            error_message="Failed to create zip archive",
        )

    def unzip(
        self,
        vm: VirtualEnvironment,
        *,
        archive_path: str,
        dest_dir: str,
        timeout: float,
    ) -> None:
        execute(
            vm,
            ["node", "-e", UNZIP_SCRIPT, archive_path, dest_dir],
            timeout=timeout,
            error_message="Failed to unzip archive",
        )
