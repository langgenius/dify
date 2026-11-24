import type { TagResponse } from '@dify/contracts/api/console/tags/types.gen'
import type { ReactElement } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import en from '@/i18n/locales/en-US/common.json'
import ja from '@/i18n/locales/ja-JP/common.json'
import zh from '@/i18n/locales/zh-Hans/common.json'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { renderWithTags } from '@/test/tag-management'
import { TagManagementDialog } from '../tag-management-dialog'
import { TagSelector } from '../tag-selector'

vi.unmock('react-i18next')

const locales = { 'en-US': en, 'ja-JP': ja, 'zh-Hans': zh }
const duplicateNameError = () =>
  apiError({ status: 400, code: 'invalid_param', message: 'Tag name already exists' })
const original: TagResponse = {
  id: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
  name: 'Original',
  type: 'agent',
  binding_count: '2',
}
let saved = original
const fake = setupFakeApi(() => ({
  console: {
    tags: {
      get: () => [saved],
      post: ({ body }) => ({ id: 'new-tag', ...body }),
      byTagId: {
        patch: ({ body }) => {
          saved = { ...saved, ...body }
          return saved
        },
      },
    },
  },
}))

async function renderLocalized(language: keyof typeof locales, ui: ReactElement) {
  const i18n = createInstance()
  await i18n.init({
    lng: language,
    resources: { [language]: { common: locales[language] } },
    keySeparator: false,
  })
  return renderWithTags(
    <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>,
    [original],
    ['agent.tag.manage'],
  )
}

beforeEach(() => {
  saved = original
})
afterEach(() => {
  toast.dismiss()
})

it.each([
  {
    language: 'ja-JP',
    action: 'create',
    expected: '同じ名前のタグがすでに存在します。',
  },
  {
    language: 'zh-Hans',
    action: 'rename',
    expected: '已存在同名标签。',
  },
  {
    language: 'en-US',
    action: 'rename',
    expected: 'A tag with this name already exists.',
  },
] as const)(
  'shows one $language error notification for a $action conflict and accepts a correction',
  async ({ language, action, expected }) => {
    const error = duplicateNameError()
    const common = locales[language]
    await renderLocalized(language, <TagManagementDialog type="agent" show onClose={() => {}} />)
    const dialog = page.getByRole('dialog', { name: common['tag.manageTags'] })
    let input = dialog.getByRole('textbox', { name: common['tag.addNew'] })
    if (action === 'create') fake.console.tags.post.mockRejectedValueOnce(error)
    else {
      fake.console.tags.byTagId.patch.mockRejectedValueOnce(error)
      await dialog.getByRole('button', { name: `${common['operation.edit']} Original` }).click()
      input = dialog.getByRole('textbox', { name: `${common['operation.rename']} Original` })
    }
    await input.fill('Finance')
    await userEvent.keyboard('{Enter}')
    const notifications = page.getByRole('region', { name: 'Notifications' })
    await expect.element(notifications.getByRole('dialog', { name: expected })).toBeVisible()
    await expect.element(dialog.getByText(expected, { exact: true })).not.toBeInTheDocument()
    await expect.element(input).toHaveAttribute('aria-invalid', 'true')
    await expect.element(input).toHaveValue('Finance')
    expect(notifications.getByRole('dialog').all()).toHaveLength(1)

    await input.fill('Corrected')
    await userEvent.keyboard('{Enter}')
    if (action === 'create') {
      await expect.element(input).toHaveValue('')
      await expect.element(dialog.getByText('Original', { exact: true })).toBeVisible()
      expect(fake.console.tags.post).toHaveBeenCalledTimes(2)
    } else {
      await expect.element(dialog.getByText('Corrected', { exact: true })).toBeVisible()
      expect(fake.console.tags.byTagId.patch).toHaveBeenCalledTimes(2)
    }
    await expect.element(dialog.getByText('2', { exact: true })).toBeVisible()
  },
)

it('shows a single Japanese notification when creating from a card races a concurrent creation', async () => {
  fake.console.tags.post.mockRejectedValueOnce(duplicateNameError())
  await renderLocalized(
    'ja-JP',
    <TagSelector type="agent" targetId="agent-1" value={[original]} canBindOrUnbindTags />,
  )
  await page.getByRole('combobox', { name: 'Original' }).click()
  await page.getByRole('combobox', { name: ja['tag.selectorPlaceholder'] }).fill('Finance')
  await page.getByRole('option', { name: /Finance/ }).click()
  const notifications = page.getByRole('region', { name: 'Notifications' })
  await expect
    .element(notifications.getByRole('dialog', { name: '同じ名前のタグがすでに存在します。' }))
    .toBeVisible()
  expect(notifications.getByRole('dialog').all()).toHaveLength(1)
  expect(fake.console.tags.post).toHaveBeenCalledExactlyOnceWith({
    body: { name: 'Finance', type: 'agent' },
  })
})
