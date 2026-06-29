import assert from 'node:assert/strict'
import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const thisDir = dirname(fileURLToPath(import.meta.url))
const consoleRoot = resolve(thisDir, './generated/api/console')

const unexpectedConsoleRootOutputs = [
  'client.gen.ts',
  'sdk.gen.ts',
  'types.gen.ts',
  'client',
  'core',
]

for (const output of unexpectedConsoleRootOutputs) {
  assert.equal(
    fs.existsSync(resolve(consoleRoot, output)),
    false,
    `console contract entry job must not generate ${output}`,
  )
}

const { zFormInputConfig } = await import(
  pathToFileURL(resolve(thisDir, './generated/api/console/agent/zod.gen.ts')).href,
)

const paragraphInput = zFormInputConfig.safeParse({
  output_variable_name: 'answer',
  type: 'paragraph',
})

assert.equal(paragraphInput.success, true)
