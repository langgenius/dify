import type { TagResponse } from '@dify/contracts/api/console/tags/types.gen'
import type { ReactElement } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import en from '@/i18n/locales/en-US/common.json'
import ja from '@/i18n/locales/ja-JP/common.json'
import zh from '@/i18n/locales/zh-Hans/common.json'
import { renderWithTags } from '@/test/tag-management'
import { TagManagementDialog } from '../tag-management-dialog'
import { TagSelector } from '../tag-selector'

vi.unmock('react-i18next')

const locales = { 'en-US': en, 'ja-JP': ja, 'zh-Hans': zh }
const original: TagResponse = {
  id: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
  name: 'Original',
  type: 'agent',
  binding_count: '2',
}
// Exercise the real Console transport, including suppression of its default error toast.
function installTagApi() {
  const writes: Array<{ method: string; name: string }> = []
  let saved = original
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname.endsWith('/tags')) return Response.json([saved])
    const create = request.method === 'POST' && pathname.endsWith('/tags')
    const rename = request.method === 'PATCH' && pathname.endsWith(`/tags/${original.id}`)
    if (!create && !rename) throw new Error(`Unexpected request: ${request.method} ${pathname}`)
    const { name } = (await request.json()) as { name: string }
    writes.push({ method: request.method, name })
    if (name === 'Finance') {
      return Response.json(
        { code: 'invalid_param', message: 'Tag name already exists' },
        { status: 400 },
      )
    }
    if (rename) saved = { ...saved, name }
    return Response.json(create ? { ...original, id: 'new-tag', name } : saved)
  })
  return writes
}

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

afterEach(() => {
  vi.restoreAllMocks()
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
    const writes = installTagApi()
    const common = locales[language]
    await renderLocalized(language, <TagManagementDialog type="agent" show onClose={() => {}} />)
    const dialog = page.getByRole('dialog', { name: common['tag.manageTags'] })
    let input = dialog.getByRole('textbox', { name: common['tag.addNew'] })
    if (action === 'rename') {
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
    } else {
      await expect.element(dialog.getByText('Corrected', { exact: true })).toBeVisible()
    }
    const method = action === 'create' ? 'POST' : 'PATCH'
    expect(writes).toEqual([
      { method, name: 'Finance' },
      { method, name: 'Corrected' },
    ])
    await expect.element(dialog.getByText('2', { exact: true })).toBeVisible()
  },
)

it('shows a single Japanese notification when creating from a card races a concurrent creation', async () => {
  const writes = installTagApi()
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
  expect(writes).toEqual([{ method: 'POST', name: 'Finance' }])
})
