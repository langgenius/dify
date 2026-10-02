// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { getTranslationSourceKey } from '../check-i18n-plurals'

describe('locale-specific plural keys', () => {
  const sourceKeys = new Set(['skill.references_one', 'skill.references_other', 'skill.title'])

  it.each([
    ['ru-RU', 'few'],
    ['ru-RU', 'many'],
    ['ar-TN', 'zero'],
    ['ar-TN', 'two'],
    ['ar-TN', 'few'],
    ['ar-TN', 'many'],
    ['sl-SI', 'two'],
    ['fr-FR', 'many'],
    ['en-US', 'zero'],
  ])('accepts %s %s without treating it as an extra key for auto-removal', (locale, category) => {
    expect(getTranslationSourceKey(sourceKeys, `skill.references_${category}`, locale)).toBe(
      'skill.references_other',
    )
  })

  it.each([
    ['ru-RU', 'skill.references_two'],
    ['en-US', 'skill.references_few'],
    ['ru-RU', 'skill.unknown_few'],
    ['ru-RU', 'otherNamespace.references_few'],
    ['ru-RU', 'skill.title_many'],
    ['ru-RU', 'skill.references_typo'],
  ])('still rejects unrelated or invalid keys in %s: %s', (locale, key) => {
    expect(getTranslationSourceKey(sourceKeys, key, locale)).toBeUndefined()
  })

  it('uses ordinal categories for ordinal families', () => {
    const ordinalKeys = new Set(['position_ordinal_other'])
    expect(getTranslationSourceKey(ordinalKeys, 'position_ordinal_two', 'en-US')).toBe(
      'position_ordinal_other',
    )
    expect(getTranslationSourceKey(ordinalKeys, 'position_ordinal_zero', 'en-US')).toBeUndefined()
  })

  it('preserves Russian plural variants when the CLI removes unrelated extra keys', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dify-i18n-plurals-'))
    try {
      await mkdir(path.join(directory, 'scripts'))
      for (const file of ['check-i18n.js', 'check-i18n-plurals.ts', 'check-i18n-values.ts']) {
        await copyFile(
          new URL(`../${file}`, import.meta.url),
          path.join(directory, 'scripts', file),
        )
      }
      for (const locale of ['en-US', 'ru-RU'])
        await mkdir(path.join(directory, 'i18n', 'locales', locale), { recursive: true })
      await writeFile(path.join(directory, 'package.json'), '{"type":"module"}')
      await writeFile(
        path.join(directory, 'i18n', 'languages.ts'),
        `export default { languages: [{ value: 'en-US', supported: true }, { value: 'ru-RU', supported: true }] }`,
      )
      const source = { references_one: '{{count}} agent', references_other: '{{count}} agents' }
      const translation = {
        references_one: '{{count}} агент',
        references_other: '{{count}} агента',
        references_few: '{{count}} агента',
        references_many: '{{count}} агентов',
      }
      await writeFile(path.join(directory, 'i18n/locales/en-US/skill.json'), JSON.stringify(source))
      const target = path.join(directory, 'i18n/locales/ru-RU/skill.json')
      await writeFile(target, JSON.stringify({ ...translation, obsolete: 'Remove me' }))

      execFileSync(process.execPath, [
        path.join(directory, 'scripts/check-i18n.js'),
        '--file',
        'skill',
        '--lang',
        'ru-RU',
        '--auto-remove',
      ])

      expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(translation)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
