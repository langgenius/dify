import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import tsParser from '@typescript-eslint/parser'
import { Linter } from 'eslint'
import { it } from 'vite-plus/test'
import rule from './prefer-tailwind-icons.js'

const options = {
  prefix: 'i-',
  propMappings: { size: 'size', width: 'w', height: 'h' },
  libraries: [
    {
      prefix: 'i-custom-',
      source: '^@/app/components/base/icons/src/(?<set>(?:public|vender)(?:/.*)?)$',
      name: '^(?<name>.*)$',
      availableClasses: [
        'i-custom-vender-line-arrows-download-02',
        'i-custom-vender-line-alertsAndFeedback-warning',
      ],
    },
    { source: '^@remixicon/react$', name: '^(?<set>Ri)(?<name>.+)$' },
    {
      source: '^@(?<set>heroicons)/react/24/(?<variant>solid)$',
      name: '^(?<name>.*)Icon$',
    },
  ],
}

function verify(code, ruleOptions = options) {
  const linter = new Linter({ cwd: resolve('..') })
  return linter.verify(
    code,
    [
      {
        files: ['**/*.tsx'],
        languageOptions: {
          parser: tsParser,
          parserOptions: {
            ecmaFeatures: { jsx: true },
            ecmaVersion: 'latest',
            sourceType: 'module',
          },
        },
        plugins: { dify: { rules: { 'prefer-tailwind-icons': rule } } },
        rules: { 'dify/prefer-tailwind-icons': ['warn', ruleOptions] },
      },
    ],
    { filename: 'test.tsx' },
  )
}

it('preserves named icon imports and local aliases', () => {
  const messages = verify(`
    import { Download02 as DownloadIcon } from '@/app/components/base/icons/src/vender/line/arrows'
    import { RiSearchLine as SearchIcon } from '@remixicon/react'
    export const example = <><DownloadIcon /><SearchIcon /></>
  `)

  assert.deepEqual(
    messages.map(({ messageId, message }) => ({ messageId, message })),
    [
      {
        messageId: 'preferTailwindIcon',
        message:
          'Prefer using Tailwind CSS icon class "i-custom-vender-line-arrows-download-02" over "DownloadIcon" from "@/app/components/base/icons/src/vender/line/arrows"',
      },
      {
        messageId: 'preferTailwindIcon',
        message:
          'Prefer using Tailwind CSS icon class "i-ri-search-line" over "SearchIcon" from "@remixicon/react"',
      },
    ],
  )
})

it('derives a default icon name from its leaf path and keeps the parent library set', () => {
  const messages = verify(`
    import DownloadIcon from '@/app/components/base/icons/src/vender/line/arrows/Download02'
    export const example = <DownloadIcon size={16} className="text-current" aria-hidden />
  `)

  assert.equal(messages.length, 1)
  assert.equal(messages[0].messageId, 'preferTailwindIcon')
  assert.equal(
    messages[0].message,
    'Prefer using Tailwind CSS icon class "i-custom-vender-line-arrows-download-02" over "DownloadIcon" from "@/app/components/base/icons/src/vender/line/arrows/Download02"',
  )
  assert.equal(
    messages[0].suggestions[0].fix.text,
    '<span className={"i-custom-vender-line-arrows-download-02 size-4 text-current"} aria-hidden />',
  )
})

it('applies the configured name and variant captures to a leaf default import', () => {
  const messages = verify(`
    import Notification from '@heroicons/react/24/solid/BellIcon'
    export const example = <Notification />
  `)

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /"i-heroicons-bell-solid"/)
})

it('reports a default icon used as a runtime value without JSX', () => {
  const messages = verify(`
    import DownloadIcon from '@/app/components/base/icons/src/vender/line/arrows/Download02'
    export const icons = { download: DownloadIcon }
  `)

  assert.equal(messages.length, 1)
  assert.equal(messages[0].messageId, 'preferTailwindIconImport')
  assert.equal(
    messages[0].message,
    'Icon "Download02" from "@/app/components/base/icons/src/vender/line/arrows/Download02" can be replaced with Tailwind CSS class "i-custom-vender-line-arrows-download-02"',
  )
})

it('ignores type-only declarations and specifiers, and unused imports', () => {
  const messages = verify(`
    import type DownloadIcon from '@/app/components/base/icons/src/vender/line/arrows/Download02'
    import { type Arrow } from '@/app/components/base/icons/src/vender/line/arrows'
    import Robot from '@/app/components/base/icons/src/public/avatar/Robot'
    export type Icons = [typeof DownloadIcon, typeof Arrow]
  `)

  assert.deepEqual(messages, [])
})

it('ignores default imports without a matching parent library or icon name', () => {
  const messages = verify(`
    import RemixIcon from '@remixicon/react'
    import OtherIcon from 'other-icons/Download02'
    import NonIcon from '@remixicon/react/Provider'
    export const icons = [RemixIcon, OtherIcon, NonIcon]
  `)

  assert.deepEqual(messages, [])
})

it('ignores asset default imports inside a configured icon library', () => {
  const messages = verify(`
    import iconData from '@/app/components/base/icons/src/vender/line/arrows/Download02.json'
    import iconStyles from '@/app/components/base/icons/src/vender/line/arrows/Download02.css'
    import iconUrl from '@/app/components/base/icons/src/vender/line/arrows/Download02.svg?url'
    export const assets = [iconData, iconStyles, iconUrl]
  `)

  assert.deepEqual(messages, [])
})

it('uses the real collection spelling for named and aliased default imports', () => {
  const messages = verify(`
    import { Warning as NamedWarning } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
    import WarningIcon from '@/app/components/base/icons/src/vender/line/alertsAndFeedback/Warning'
    export const example = <><NamedWarning /><WarningIcon /></>
  `)

  assert.equal(messages.length, 2)
  for (const message of messages) {
    assert.equal(message.messageId, 'preferTailwindIcon')
    assert.match(message.message, /"i-custom-vender-line-alertsAndFeedback-warning"/)
    assert.equal(message.fix, undefined)
    assert.equal(
      message.suggestions[0].fix.text,
      '<span className={"i-custom-vender-line-alertsAndFeedback-warning"} />',
    )
  }
})

it('uses the real collection spelling for runtime values', () => {
  const messages = verify(`
    import WarningIcon from '@/app/components/base/icons/src/vender/line/alertsAndFeedback/Warning'
    export const icons = { warning: WarningIcon }
  `)

  assert.equal(messages.length, 1)
  assert.equal(messages[0].messageId, 'preferTailwindIconImport')
  assert.match(messages[0].message, /"i-custom-vender-line-alertsAndFeedback-warning"/)
})

it('omits unavailable classes for named and default imports in JSX and runtime values', () => {
  const messages = verify(`
    import { Robot, User } from '@/app/components/base/icons/src/public/avatar'
    import PluginIcon from '@/app/components/base/icons/src/vender/plugin/Plugin'
    import StarIcon from '@/app/components/base/icons/src/vender/Star'
    export const example = <><Robot /><PluginIcon /></>
    export const icons = [User, StarIcon]
  `)

  assert.deepEqual(messages, [])
})

it('does not choose between ambiguous collection spellings', () => {
  const messages = verify(
    `
    import WarningIcon from '@/app/components/base/icons/src/vender/line/alertsAndFeedback/Warning'
    export const example = <WarningIcon />
  `,
    {
      ...options,
      libraries: [
        {
          ...options.libraries[0],
          availableClasses: [
            'i-custom-vender-line-alertsAndFeedback-warning',
            'i-custom-vender-line-AlertsAndFeedback-warning',
          ],
        },
      ],
    },
  )

  assert.deepEqual(messages, [])
})

it('rejects ambiguous collection spellings even when one matches the derived class exactly', () => {
  const messages = verify(
    `
    import DownloadIcon from '@/app/components/base/icons/src/vender/line/arrows/Download02'
    export const example = <DownloadIcon />
  `,
    {
      ...options,
      libraries: [
        {
          ...options.libraries[0],
          availableClasses: [
            'i-custom-vender-line-arrows-download-02',
            'i-custom-vender-line-arrows-Download-02',
          ],
        },
      ],
    },
  )

  assert.deepEqual(messages, [])
})

it('rejects every class when a library configures an empty collection', () => {
  const messages = verify(
    `
    import DownloadIcon from '@/app/components/base/icons/src/vender/line/arrows/Download02'
    export const example = <DownloadIcon />
  `,
    {
      ...options,
      libraries: [{ ...options.libraries[0], availableClasses: [] }],
    },
  )

  assert.deepEqual(messages, [])
})
