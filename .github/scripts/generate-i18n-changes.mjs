import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const baseSha = process.env.BASE_SHA || ''
const headSha = process.env.HEAD_SHA || ''
const files = (process.env.CHANGED_FILES || '').split(/\s+/).filter(Boolean)
const outputPath = process.env.I18N_CHANGES_OUTPUT_PATH || '/tmp/i18n-changes.json'

const englishPath = fileStem => path.join(repoRoot, 'web', 'i18n', 'en-US', `${fileStem}.json`)

const readCurrentJson = (fileStem) => {
  const filePath = englishPath(fileStem)
  if (!fs.existsSync(filePath))
    return null

  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

const readBaseJson = (fileStem) => {
  if (!baseSha)
    return null

  try {
    const relativePath = `web/i18n/en-US/${fileStem}.json`
    const content = execFileSync('git', ['show', `${baseSha}:${relativePath}`], { encoding: 'utf8' })
    return JSON.parse(content)
  }
  catch {
    return null
  }
}

const compareJson = (beforeValue, afterValue) => JSON.stringify(beforeValue) === JSON.stringify(afterValue)

const changes = {}

for (const fileStem of files) {
  const currentJson = readCurrentJson(fileStem)
  const beforeJson = readBaseJson(fileStem) || {}
  const afterJson = currentJson || {}
  const added = {}
  const updated = {}
  const deleted = []

  for (const [key, value] of Object.entries(afterJson)) {
    if (!(key in beforeJson)) {
      added[key] = value
      continue
    }

    if (!compareJson(beforeJson[key], value)) {
      updated[key] = {
        before: beforeJson[key],
        after: value,
      }
    }
  }

  for (const key of Object.keys(beforeJson)) {
    if (!(key in afterJson))
      deleted.push(key)
  }

  changes[fileStem] = {
    fileDeleted: currentJson === null,
    added,
    updated,
    deleted,
  }
}

fs.writeFileSync(
  outputPath,
  JSON.stringify({
    baseSha,
    headSha,
    files,
    changes,
  })
)
