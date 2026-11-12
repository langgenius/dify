import type { ExternalAgentAssetResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type {
  PostFilesUploadData,
  PostFilesUploadResponse,
} from '@dify/contracts/api/console/files/types.gen'
import type { ConsoleClient } from '@/service/console'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import {
  createExternalAgentAsset,
  createExternalAgentCapabilities,
  createExternalAgentDetail,
} from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createGifFile } from '@/test/fixtures/image-files'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ExternalRoster } from '../external-roster'

// boundary: use real translations and the fixture's I18nextProvider instead of the global translator double.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

const { uploadImage, list, detail, info } = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  info: vi.fn(),
  uploadImage:
    vi.fn<(input: Pick<PostFilesUploadData, 'body'>) => Promise<PostFilesUploadResponse>>(),
}))

// boundary: the existing generic file-upload service persists images; roster and picker interactions stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.post': uploadImage,
      'externalAgents.capabilities.get': async () => createExternalAgentCapabilities(),
      'externalAgents.get': list,
      'externalAgents.byAgentId.get': detail,
      'externalAgents.byAgentId.info.patch': info,
    }),
  }
})

// boundary: navigation belongs to the application router, outside the icon editing journey.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

let asset: ExternalAgentAssetResponse

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
  await render(
    <QueryProvider>
      <NuqsTestingAdapter hasMemory>
        <I18nextProvider i18n={i18n}>
          <ExternalRoster />
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
  asset = createExternalAgentAsset({ icon_type: 'emoji', icon: '😀', icon_background: '#FEF3F2' })
  list
    .mockReset()
    .mockImplementation((input: Parameters<ConsoleClient['externalAgents']['get']>[0]) => {
      const items = input?.query?.enabled === false ? [] : [asset]
      return {
        items,
        page: input?.query?.page ?? 1,
        limit: input?.query?.limit ?? 20,
        total: items.length,
      }
    })
  detail.mockReset().mockImplementation(() => createExternalAgentDetail({ asset }))
  info
    .mockReset()
    .mockImplementation(
      ({ body }: Parameters<ConsoleClient['externalAgents']['byAgentId']['info']['patch']>[0]) => {
        asset = { ...asset, ...body.changes, metadata_revision: asset.metadata_revision + 1 }
        return asset
      },
    )
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
  await expect.element(card().getByText('😎', { exact: true })).toBeVisible()
  expect(info).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: asset.id },
    body: { expected_revision: 1, changes: { icon: '😎', icon_background: '#F3FEE7' } },
  })
  await openEdit()
  await avatar().click()
  await expect.element(picker().getByRole('radio', { name: 'Green', exact: true })).toBeChecked()
  await userEvent.keyboard('{Escape}')
  await expect.element(picker()).not.toBeInTheDocument()
  await edit().getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(uploadImage).not.toHaveBeenCalled()
})

it('uploads a native image for the draft and saves its file ID without inventing a persisted image URL', async () => {
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
  expect(info).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: asset.id },
    body: {
      expected_revision: 1,
      changes: { icon_type: 'image', icon: 'external-agent-icon', icon_background: null },
    },
  })
  // The current asset protocol returns the file ID but no authorized image URL.
  expect(card().element().querySelector('img')).toBeNull()
  await openEdit()
  expect(avatar().element().querySelector('img')).toBeNull()
  await edit().getByRole('button', { name: 'Cancel', exact: true }).click()
})
