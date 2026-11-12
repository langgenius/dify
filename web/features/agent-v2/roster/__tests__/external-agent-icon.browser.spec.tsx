import type {
  PostFilesUploadData,
  PostFilesUploadResponse,
} from '@dify/contracts/api/console/files/types.gen'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createGifFile } from '@/test/fixtures/image-files'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ExternalRoster } from '../external-roster'
import { createExternalRosterPreview } from '../external-roster-preview'

// boundary: use real translations and the fixture's I18nextProvider instead of the global translator double.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

const { uploadImage } = vi.hoisted(() => ({
  uploadImage:
    vi.fn<(input: Pick<PostFilesUploadData, 'body'>) => Promise<PostFilesUploadResponse>>(),
}))

// boundary: the existing generic file-upload service persists images; roster and picker interactions stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'files.upload.post': uploadImage }),
  }
})

const card = () =>
  page.getByRole('listitem', { name: 'Contract Review Agent', exact: true, includeHidden: true })
const edit = () => page.getByRole('dialog', { name: 'Edit info', exact: true })
const avatar = () => edit().getByRole('button', { name: 'Change agent icon', exact: true })
const picker = () => page.getByRole('dialog', { name: 'Choose icon', exact: true })

async function setup() {
  await page.viewport(1223, 772)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, app, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  queryClient.setQueryData(emojiCatalogOptions.queryKey, [
    {
      id: 'faces',
      label: 'Faces',
      items: [
        { emoji: '😀', label: 'Grinning face', version: 1 },
        { emoji: '😎', label: 'Cool face', version: 1 },
      ],
    },
  ])
  onTestFinished(() => queryClient.clear())
  const agent = createExternalRosterPreview().find((agent) => agent.key === 'contract-review')!
  await render(
    <QueryProvider>
      <NuqsTestingAdapter hasMemory>
        <I18nextProvider i18n={i18n}>
          <ExternalRoster
            initialAgents={[
              {
                ...agent,
                icon: { icon_type: 'emoji', icon: '😀', icon_background: '#FEF3F2' },
              },
            ]}
          />
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryProvider>,
  )
  await expect.element(card()).toBeVisible()
}

async function openEdit() {
  await card().hover()
  await card()
    .getByRole('button', { name: 'More actions for Contract Review Agent', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Edit info', exact: true }).click()
  await expect.element(edit()).toBeVisible()
}

async function chooseCoolGreen() {
  await picker().getByRole('combobox', { name: 'Search emoji...', exact: true }).fill('Cool face')
  await picker().getByRole('gridcell', { name: 'Cool face', exact: true }).click()
  await picker().getByRole('radio', { name: 'Green', exact: true }).click()
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  uploadImage.mockImplementation(async ({ body: { file } }) => {
    if (!(file instanceof File)) throw new TypeError('Expected a native icon File upload')
    return { id: 'external-agent-icon', name: file.name, size: file.size }
  })
})

it('keeps nested emoji drafts local, discards both cancellation scopes, and commits emoji and background on Save', async () => {
  await setup()
  await openEdit()
  await avatar().click()
  await expect.element(picker().getByRole('tab', { name: 'Image', exact: true })).toBeVisible()
  await chooseCoolGreen()
  await userEvent.keyboard('{Escape}')
  await expect.element(picker()).not.toBeInTheDocument()
  await expect.element(edit()).toBeVisible()
  await expect.element(avatar()).toHaveFocus()
  await expect.element(avatar().getByText('😀', { exact: true })).toBeVisible()
  await avatar().click()
  await expect.element(picker().getByRole('radio', { name: 'Red', exact: true })).toBeChecked()
  await chooseCoolGreen()
  await picker().getByRole('button', { name: 'OK', exact: true }).click()
  await expect.element(picker()).not.toBeInTheDocument()
  await expect.element(edit()).toBeVisible()
  await expect.element(avatar()).toHaveFocus()
  await expect.element(avatar().getByText('😎', { exact: true })).toBeVisible()
  await expect.element(card().getByText('😀', { exact: true })).toBeVisible()
  await edit().getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(edit()).not.toBeInTheDocument()
  await expect.element(card().getByText('😀', { exact: true })).toBeVisible()
  await openEdit()
  await expect.element(avatar().getByText('😀', { exact: true })).toBeVisible()
  await avatar().click()
  await chooseCoolGreen()
  await picker().getByRole('button', { name: 'OK', exact: true }).click()
  await expect.element(picker()).not.toBeInTheDocument()
  await edit().getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(edit()).not.toBeInTheDocument()
  const savedEmoji = card().getByText('😎', { exact: true })
  await expect.element(savedEmoji).toBeVisible()
  expect(getComputedStyle(savedEmoji.element()).backgroundColor).toBe('rgb(243, 254, 231)')
  await openEdit()
  await avatar().click()
  await expect.element(picker().getByRole('radio', { name: 'Green', exact: true })).toBeChecked()
  await userEvent.keyboard('{Escape}')
  await expect.element(picker()).not.toBeInTheDocument()
  await edit().getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(uploadImage).not.toHaveBeenCalled()
})

it('uploads through the generic files service and updates the roster image only after the outer Save', async () => {
  await setup()
  await openEdit()
  await avatar().click()
  await picker().getByRole('tab', { name: 'Image', exact: true }).click()
  const file = createGifFile('external-agent.gif')
  await picker().getByTestId('image-input').upload(file)
  const preview = picker().getByRole('img', { name: 'Image', exact: true })
  await expect.element(preview).toBeVisible()
  await expect.poll(() => (preview.element() as HTMLImageElement).naturalWidth).toBe(1)
  expect(uploadImage).not.toHaveBeenCalled()
  await picker().getByRole('button', { name: 'OK', exact: true }).click()
  await expect.element(picker()).not.toBeInTheDocument()
  await expect.element(edit()).toBeVisible()
  await expect.element(avatar()).toHaveFocus()
  await expect.poll(() => avatar().element().querySelector('img')?.naturalWidth).toBe(1)
  const draftSrc = avatar().element().querySelector('img')!.src
  await expect.element(card().getByText('😀', { exact: true })).toBeVisible()
  expect(card().element().querySelector('img')).toBeNull()
  expect(uploadImage).toHaveBeenCalledTimes(1)
  const uploaded = uploadImage.mock.lastCall![0].body.file
  if (!(uploaded instanceof File))
    throw new TypeError('Expected the uploaded icon to remain a File')
  expect(uploaded.name).toBe(file.name)
  expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(
    new Uint8Array(await file.arrayBuffer()),
  )
  await edit().getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(edit()).not.toBeInTheDocument()
  await expect.poll(() => card().element().querySelector('img')?.naturalWidth).toBe(1)
  expect(card().element().querySelector('img')!.src).toBe(draftSrc)
  await openEdit()
  await expect.poll(() => avatar().element().querySelector('img')?.naturalWidth).toBe(1)
  expect(avatar().element().querySelector('img')!.src).toBe(draftSrc)
  await edit().getByRole('button', { name: 'Cancel', exact: true }).click()
})
