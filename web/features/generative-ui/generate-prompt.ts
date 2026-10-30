import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  GENERATIVE_UI_LIBRARY_VERSION,
  promptOptions,
  schemaLibrary,
} from './registry/definitions.ts'

const outputDirectory = new URL('../../../api/resources/generative_ui/', import.meta.url)
const outputFile = new URL(`${GENERATIVE_UI_LIBRARY_VERSION}.txt`, outputDirectory)
const prompt = `${schemaLibrary.prompt(promptOptions)}\n`

async function main() {
  if (process.argv.includes('--check')) {
    const current = await readFile(outputFile, 'utf8')
    if (current !== prompt) {
      throw new Error(
        `Regenerate ${fileURLToPath(outputFile)} with the generative-ui prompt script.`,
      )
    }
  } else {
    await mkdir(outputDirectory, { recursive: true })
    await writeFile(outputFile, prompt, 'utf8')
  }
}

void main()
