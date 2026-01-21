import type { Rule } from 'eslint'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import consistentPlaceholders from '../eslint-rules/rules/consistent-placeholders.js'

const tempRoots: string[] = []

const createFixture = (
  english: Record<string, string>,
  locale: Record<string, string>,
  lang = 'zh-Hans',
  fileName = 'test.json',
) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dify-i18n-'))
  const i18nDir = path.join(root, 'i18n')
  const enDir = path.join(i18nDir, 'en-US')
  const localeDir = path.join(i18nDir, lang)

  fs.mkdirSync(enDir, { recursive: true })
  fs.mkdirSync(localeDir, { recursive: true })

  const englishPath = path.join(enDir, fileName)
  const localePath = path.join(localeDir, fileName)

  fs.writeFileSync(englishPath, `${JSON.stringify(english, null, 2)}\n`)
  fs.writeFileSync(localePath, `${JSON.stringify(locale, null, 2)}\n`)

  tempRoots.push(root)

  return {
    localePath,
    localeContent: fs.readFileSync(localePath, 'utf8'),
  }
}

const runRule = (filename: string, sourceText: string) => {
  const reports: string[] = []
  const context = {
    filename,
    sourceCode: { text: sourceText },
    report: (descriptor: { message: string }) => {
      reports.push(descriptor.message)
    },
  } as unknown as Rule.RuleContext
  const listeners = (consistentPlaceholders as Rule.RuleModule).create(context)
  type ProgramNode = Parameters<NonNullable<typeof listeners.Program>>[0]
  listeners.Program?.({} as ProgramNode)
  return reports
}

afterEach(() => {
  tempRoots.forEach((root) => {
    fs.rmSync(root, { recursive: true, force: true })
  })
  tempRoots.length = 0
})

describe('consistent-placeholders tag validation', () => {
  it('reports missing tags in another locale', () => {
    const { localePath, localeContent } = createFixture(
      { msg: 'Click <b>here</b>.' },
      { msg: 'Click here.' },
    )

    const reports = runRule(localePath, localeContent)

    expect(reports.some(message =>
      message.includes('Tag mismatch')
      && message.includes('msg')
      && message.includes('Expected')
      && message.includes('Got'),
    )).toBe(true)
    expect(reports.join('\n')).toContain('<b>')
  })

  it('reports mismatched numeric tags', () => {
    const { localePath, localeContent } = createFixture(
      { msg: 'Tap <0>here</0>.' },
      { msg: 'Tap <1>here</1>.' },
    )

    const reports = runRule(localePath, localeContent)

    expect(reports.join('\n')).toContain('<0>')
    expect(reports.join('\n')).toContain('<1>')
    expect(reports.some(message => message.includes('Tag mismatch'))).toBe(true)
  })

  it('reports unbalanced tags', () => {
    const { localePath, localeContent } = createFixture(
      { msg: 'Use the <link>link</link>.' },
      { msg: 'Use the <link>link.' },
    )

    const reports = runRule(localePath, localeContent)

    expect(reports.some(message =>
      message.includes('Unbalanced tags')
      && message.includes('Expected')
      && message.includes('Got'),
    )).toBe(true)
  })
})
