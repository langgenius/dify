// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs'
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vite-plus/test'
import enUS from '@/i18n/locales/en-US/api-error.json'
import zhHans from '@/i18n/locales/zh-Hans/api-error.json'
import { getInitOptions } from '@/i18n/settings'
import { translateApiError } from '../api-error-message'

async function createI18n(lng: string, resources: Record<string, Record<string, string>>) {
  const instance = createInstance()
  await instance.init({
    ...getInitOptions(['apiError']),
    lng,
    resources: Object.fromEntries(
      Object.entries(resources).map(([locale, apiError]) => [locale, { apiError }]),
    ),
  })
  return instance
}

const keyLimit = {
  code: 'max_keys_exceeded',
  message: 'Cannot create more than 10 API keys for this resource type.',
  status: 400,
  details: { max_keys: 10 },
}

describe('translateApiError', () => {
  it('translates a listed code and interpolates its details', async () => {
    const i18n = await createI18n('zh-Hans', { 'en-US': enUS, 'zh-Hans': zhHans })

    await expect(translateApiError(keyLimit, i18n)).resolves.toBe(
      '此处最多只能创建 10 个 API 密钥。',
    )
  })

  it('never reads served details as i18next options', async () => {
    const i18n = await createI18n('zh-Hans', { 'en-US': enUS, 'zh-Hans': zhHans })
    const body = { ...keyLimit, details: { max_keys: 10, lng: 'en-US', ns: 'other' } }

    await expect(translateApiError(body, i18n)).resolves.toBe('此处最多只能创建 10 个 API 密钥。')
  })

  it('falls back to English while a locale has no translation', async () => {
    const i18n = await createI18n('de-DE', { 'en-US': enUS, 'de-DE': {} })

    await expect(translateApiError(keyLimit, i18n)).resolves.toBe(
      'You can create at most 10 API keys here.',
    )
  })

  it('keeps the served message for unlisted codes and non-error bodies', async () => {
    const i18n = await createI18n('zh-Hans', { 'en-US': enUS, 'zh-Hans': zhHans })

    await expect(translateApiError({ code: 'app_not_found', message: 'x' }, i18n)).resolves.toBe(
      undefined,
    )
    await expect(translateApiError(undefined, i18n)).resolves.toBeUndefined()
    await expect(translateApiError(keyLimit, undefined)).resolves.toBeUndefined()
  })
})

describe('apiError translations', () => {
  it('are keyed by error codes the Console or Web contracts document', () => {
    const root = new URL('../../../packages/contracts/generated/api/', import.meta.url)
    const documented = new Set<string>()
    for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
      if (!/^(?:console|web)\b/.test(file) || !file.endsWith('types.gen.ts')) continue
      const source = readFileSync(new URL(file, root), 'utf8')
      for (const match of source.matchAll(/= ErrorResponse & \{\s*code: '([\w-]+)'/g))
        documented.add(match[1]!)
    }

    expect(documented.size).toBeGreaterThan(0)
    expect(Object.keys(enUS).filter((code) => !documented.has(code))).toEqual([])
  })
})
