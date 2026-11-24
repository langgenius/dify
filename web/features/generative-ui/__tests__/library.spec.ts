import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createParser } from '@openuidev/lang-core'
import { describe, expect, it } from 'vite-plus/test'
import {
  promptOptions,
  readOnlyPromptOptions,
  readOnlySchemaLibrary,
  schemaLibrary,
} from '../../../scripts/generate-openui-prompt'
import { difyUILibrary } from '../registry/library'
import { validateUIContent } from '../validation'

describe('Dify OpenUI component contract', () => {
  it('keeps the generated backend prompt and the rendering vocabulary in sync', async () => {
    expect(difyUILibrary.toJSONSchema()).toEqual(schemaLibrary.toJSONSchema())
    const promptFile = resolve(process.cwd(), '../api/resources/generative_ui/dify-ui-v1.txt')
    const generated = await readFile(promptFile, 'utf8')
    expect(generated).toBe(`${schemaLibrary.prompt(promptOptions)}\n`)

    const readOnlyPromptFile = resolve(
      process.cwd(),
      '../api/resources/generative_ui/dify-ui-v1-readonly.txt',
    )
    const generatedReadOnly = await readFile(readOnlyPromptFile, 'utf8')
    expect(generatedReadOnly).toBe(`${readOnlySchemaLibrary.prompt(readOnlyPromptOptions)}\n`)
    expect(generatedReadOnly).not.toContain('ActionButton(')
    expect(generatedReadOnly).not.toContain('TextField(')
    expect(readOnlySchemaLibrary.toJSONSchema().$defs).not.toHaveProperty('ActionButton')
    expect(readOnlySchemaLibrary.toJSONSchema().$defs).not.toHaveProperty('Form')
  })

  it('parses the generation examples without missing references or schema errors', () => {
    const parser = createParser(difyUILibrary.toJSONSchema(), difyUILibrary.root)
    for (const example of [
      ...(promptOptions.examples ?? []),
      ...(readOnlyPromptOptions.examples ?? []),
    ]) {
      const result = parser.parse(example)
      expect(result.root).not.toBeNull()
      expect(result.meta.errors).toEqual([])
      expect(result.meta.unresolved).toEqual([])
    }
  })

  it('degrades interactive components when allowInteractive is false while keeping display components', () => {
    const parser = createParser(difyUILibrary.toJSONSchema(), difyUILibrary.root)
    const parsed = parser.parse(`
root = Stack([metric, action, form])
metric = MetricCard("Revenue", 144, 120, "USD", "vs. previous month", true)
action = ActionButton("Export", "Export Q1 report")
form = Form("filter", "Filter", "Apply", "Apply filters", [region])
region = TextField("region", "Region", "APAC", false)
`)
    const stackChildren = parsed.root?.props.children
    const full = validateUIContent(stackChildren, 'Unavailable')
    expect(full.invalidCount).toBe(0)
    expect(full.children.map((node) => node.typeName)).toEqual([
      'MetricCard',
      'ActionButton',
      'Form',
    ])

    const readOnly = validateUIContent(stackChildren, 'Unavailable', { allowInteractive: false })
    expect(readOnly.hasContent).toBe(true)
    expect(readOnly.invalidCount).toBe(2)
    expect(readOnly.children.map((node) => node.typeName)).toEqual(['MetricCard', 'Text', 'Text'])
  })
})
