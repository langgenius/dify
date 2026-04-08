/**
 * Next.js and ESLint both stat/read `web/CLAUDE.md` in CI. A git symlink whose
 * target is missing or has CRLF in the link text fails `stat()` on Linux (ENOENT).
 * Ensure a regular file exists by copying `AGENTS.md` when needed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(new URL(import.meta.url)))
const webDir = path.resolve(scriptDir, '..')
const claudeMd = path.join(webDir, 'CLAUDE.md')
const agentsMd = path.join(webDir, 'AGENTS.md')

function ensureWebClaudeMd() {
  try {
    const st = fs.lstatSync(claudeMd)
    if (st.isSymbolicLink()) {
      try {
        fs.statSync(claudeMd)
        return
      }
      catch {
        fs.unlinkSync(claudeMd)
      }
    }
    else if (st.isFile()) {
      return
    }
  }
  catch {
    // missing
  }

  if (fs.existsSync(agentsMd))
    fs.copyFileSync(agentsMd, claudeMd)
}

ensureWebClaudeMd()
