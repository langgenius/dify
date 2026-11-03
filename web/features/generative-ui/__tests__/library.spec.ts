import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createParser } from '@openuidev/lang-core'
import { describe, expect, it } from 'vite-plus/test'
import { promptOptions, schemaLibrary } from '../registry/definitions'
import { difyUILibrary } from '../registry/library'

describe('Dify OpenUI component contract', () => {
  it('keeps the generated backend prompt and the rendering vocabulary in sync', async () => {
    expect(difyUILibrary.toJSONSchema()).toEqual(schemaLibrary.toJSONSchema())
    const promptFile = resolve(process.cwd(), '../api/resources/generative_ui/dify-ui-v1.txt')
    const generated = await readFile(promptFile, 'utf8')
    expect(generated).toBe(`${schemaLibrary.prompt(promptOptions)}\n`)
  })

  it('parses the generation examples without missing references or schema errors', () => {
    const parser = createParser(difyUILibrary.toJSONSchema(), difyUILibrary.root)
    for (const example of promptOptions.examples ?? []) {
      const result = parser.parse(example)
      expect(result.root).not.toBeNull()
      expect(result.meta.errors).toEqual([])
      expect(result.meta.unresolved).toEqual([])
    }
  })
})
