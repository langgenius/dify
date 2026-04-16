import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { normalizeMalformedAssertions } from './migrate'

const ROOT = process.cwd()
const EXTENSIONS = new Set(['.ts', '.tsx'])

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next')
      continue

    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath))
      continue
    }

    if (!EXTENSIONS.has(path.extname(entry.name)))
      continue

    files.push(absolutePath)
  }

  return files
}

async function main() {
  const files = await collectFiles(ROOT)
  let changedFileCount = 0

  await Promise.all(files.map(async (fileName) => {
    const currentText = await fs.readFile(fileName, 'utf8')
    const nextText = normalizeMalformedAssertions(currentText)
    if (nextText === currentText)
      return

    await fs.writeFile(fileName, nextText)
    changedFileCount += 1
  }))

  console.log(`Normalized malformed assertion syntax in ${changedFileCount} file(s).`)
}

export async function runNormalizeCommand(_argv: string[]) {
  await main()
}
