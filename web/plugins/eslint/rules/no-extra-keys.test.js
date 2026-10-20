// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Linter } from 'eslint'
import jsonc from 'eslint-plugin-jsonc'
import { expect, it } from 'vite-plus/test'
import consistentPlaceholders from './consistent-placeholders.js'
import noExtraKeys from './no-extra-keys.js'

function lintTranslation(translation, fix = false) {
  const directory = mkdtempSync(path.join(tmpdir(), 'dify-i18n-lint-'))
  try {
    mkdirSync(path.join(directory, 'en-US'))
    mkdirSync(path.join(directory, 'ru-RU'))
    writeFileSync(
      path.join(directory, 'en-US', 'skill.json'),
      JSON.stringify({
        references_one: '<agents>{{count}} agent</agents>',
        references_other: '<agents>{{count}} agents</agents>',
      }),
    )
    const linter = new Linter({ cwd: directory })
    const config = [
      ...jsonc.configs['flat/base'],
      {
        files: ['**/*.json'],
        plugins: {
          dify: {
            rules: {
              'no-extra-keys': noExtraKeys,
              'consistent-placeholders': consistentPlaceholders,
            },
          },
        },
        rules: { 'dify/no-extra-keys': 'error', 'dify/consistent-placeholders': 'error' },
      },
    ]
    const options = { filename: path.join(directory, 'ru-RU', 'skill.json') }
    const source = JSON.stringify(translation)
    return fix
      ? linter.verifyAndFix(source, config, options)
      : linter.verify(source, config, options)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it('keeps locale plural variants during ESLint autofix while removing unrelated keys', () => {
  const translation = {
    references_one: '<agents>{{count}} агент</agents>',
    references_other: '<agents>{{count}} агента</agents>',
    references_few: '<agents>{{count}} агента</agents>',
    references_many: '<agents>{{count}} агентов</agents>',
  }
  const result = lintTranslation(
    { ...translation, obsolete: 'Remove me', references_two: 'Invalid Russian category' },
    true,
  )
  expect(result.messages).toEqual([])
  expect(JSON.parse(result.output)).toEqual(translation)
})

it('checks interpolation and tags in locale-specific variants', () => {
  const messages = lintTranslation({ references_few: '{{num}} агента' })
  expect(messages.map((message) => message.ruleId)).toEqual([
    'dify/consistent-placeholders',
    'dify/consistent-placeholders',
  ])
  expect(messages[0].message).toContain('missing {{count}}')
  expect(messages[1].message).toContain('Trans tag mismatch')
})
