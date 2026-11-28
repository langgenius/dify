import { page, userEvent } from 'vite-plus/test/browser'
import appLogCopy from '@/i18n/locales/en-US/app-log.json'
import { createDeferred } from '@/test/deferred'
import {
  accountId,
  endUserId,
  observeDownloads,
  olderEndUser,
  openExport,
  previousTaskId,
} from './log-export-fixture'

// boundary: Use English copy to assert rendered counts, description, and expiration.
vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: copy } = await import('@/i18n/locales/en-US/app-log.json')
  function createMock(category: 'one' | 'other') {
    return createReactI18nextMock({
      'export.expiresAt': copy['export.expiresAt'],
      'export.previewRowCount': copy[`export.previewRowCount_${category}`],
      'export.previewConversationCount': copy[`export.previewConversationCount_${category}`],
      'export.previewChatflowDescription': copy['export.previewChatflowDescription'],
    })
  }
  const singular = createMock('one')
  const plural = createMock('other')
  return {
    ...original,
    ...plural,
    useTranslation: (...args: Parameters<typeof plural.useTranslation>) => {
      const translation = plural.useTranslation(...args)
      const { t: singularT } = singular.useTranslation(...args)
      return {
        ...translation,
        t: (key: unknown, options?: Record<string, unknown>) =>
          (options?.count === 1 ? singularT : translation.t)(key, options),
        ready: true,
      }
    },
  }
})

// boundary: Supply the docs URL without mounting the application locale provider.
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test${path}`,
}))

const progressDialog = page.getByRole('dialog', { name: 'appLog.export.progressTitle' })
const progressClose = progressDialog.getByRole('button', { name: 'common.operation.close' }).last()
const progressDownload = progressDialog.getByRole('button', { name: 'common.operation.download' })

it.each([
  ['chat', 'previewConversationDescription'],
  ['agent-chat', 'previewConversationDescription'],
  ['completion', 'previewCompletionDescription'],
] as const)(
  'uses the list filters and explains the CSV contents for %s',
  async (mode, descriptionKey) => {
    const { screen, trigger, dialog } = await openExport(false, mode)
    await expect
      .element(screen.getByRole('combobox', { name: 'appLog.table.header.endUser' }))
      .toBeVisible()
    await trigger.click()
    await expect
      .element(dialog.getByRole('combobox', { name: 'appLog.export.timeRange' }))
      .toHaveTextContent('appLog.filter.period.last7days')
    await expect
      .element(dialog.getByRole('combobox', { name: 'appLog.table.header.endUser' }))
      .toHaveTextContent('appLog.export.identitiesAll')
    await expect
      .element(dialog.getByText(`appLog.export.${descriptionKey}`, { exact: true }))
      .toBeVisible()
  },
)

it('defaults the list to all identities and clears specific selections from the field', async () => {
  const { screen, listQueries } = await openExport(false, 'advanced-chat')
  const label = 'appLog.table.header.endUser'
  const all = 'appLog.status.all'
  const listIdentity = screen.getByRole('combobox', { name: label })
  const allOption = page.getByRole('option', { name: all })
  const clear = screen.getByRole('button', { name: `common.operation.clear ${label}` })

  await expect.element(listIdentity.getByText(all, { exact: true })).toBeVisible()
  await listIdentity.click()
  await expect.element(allOption).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('option', { name: 'user-1024' }).click()
  await page.getByRole('option', { name: 'Mia Chen' }).click()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => listQueries.at(-1)?.getAll('account_ids')).toEqual([accountId])
  expect(listQueries.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  await clear.click()
  await expect.element(listIdentity).toHaveFocus()
  await expect.element(listIdentity.getByText(all, { exact: true })).toBeVisible()
  await expect.element(clear).not.toBeInTheDocument()
})

it('resets specific export identities from the All option', async () => {
  const { trigger, dialog } = await openExport(false, 'advanced-chat')
  const allOption = page.getByRole('option', { name: 'appLog.export.identitiesAll' })

  await trigger.click()
  const exportIdentity = dialog.getByRole('combobox', { name: 'appLog.table.header.endUser' })
  await exportIdentity.click()
  await page.getByRole('option', { name: 'user-1024' }).click()
  await expect.element(dialog.getByRole('status')).toHaveTextContent('Conversation 1 · CSV rows 2.')
  await allOption.click()
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('Conversations 2 · CSV rows 4.')
  await expect.element(allOption).toHaveAttribute('aria-selected', 'true')
})

it('previews CSV rows and submits a Completion export with the list identities', async () => {
  const { screen, trigger, dialog, listQueries, requests } = await openExport(false, 'completion')
  await screen.getByRole('combobox', { name: 'appLog.table.header.endUser' }).click()
  await page.getByRole('option', { name: 'user-1024' }).click()
  await page.getByRole('option', { name: 'Mia Chen' }).click()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => listQueries.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  expect(listQueries.at(-1)?.getAll('account_ids')).toEqual([accountId])
  await trigger.click()
  await expect.element(dialog.getByRole('status')).toHaveTextContent('CSV rows 4.')
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()
  await expect.element(progressDownload).toBeEnabled()
  expect(requests).toEqual([
    expect.objectContaining({
      estimated_rows: 4,
      end_user_ids: [endUserId],
      account_ids: [accountId],
    }),
  ])
})

it('keeps the previous export and Download available while editing the form', async () => {
  const downloadPaths = observeDownloads()
  const readyResponse = createDeferred()
  let latestReads = 0
  onTestFinished(() => readyResponse.resolve())
  const { appId, trigger, dialog, lastExport, requests } = await openExport(true, 'chat', {
    existingTaskExpiresAt: '2026-12-02T18:45:00Z',
    timezone: 'Asia/Shanghai',
    waitForLatest: () => (++latestReads > 1 ? readyResponse.promise : undefined),
  })
  await trigger.click()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.exporting' }))
    .toBeDisabled()
  await expect
    .element(lastExport.getByRole('button', { name: 'appLog.export.viewProgress' }))
    .toBeVisible()
  await expect.element(lastExport.getByText(/^Expires /)).not.toBeInTheDocument()
  readyResponse.resolve()
  const download = lastExport.getByRole('button', { name: 'common.operation.download' })
  await expect.element(download).toBeEnabled()
  await expect.element(lastExport.getByText('Expires 2026-12-03 02:45')).toBeVisible()
  await expect.element(lastExport.getByText(/invoice/)).toBeVisible()
  await expect.element(lastExport.getByText(/appLog\.export\.annotated/)).toBeVisible()
  await expect.element(lastExport.getByText(/user-1024/)).toBeVisible()
  await dialog.getByRole('combobox', { name: 'appLog.export.timeRange' }).click()
  await page.getByRole('option', { name: 'appLog.filter.period.allTime' }).click()
  await expect.element(dialog.getByRole('button', { name: 'appLog.export.submit' })).toBeEnabled()
  await download.click()
  expect(downloadPaths).toEqual([
    `/console/api/apps/${appId}/conversation-log-exports/${previousTaskId}/file`,
  ])
  expect(requests).toEqual([])
})

it('waits for both status and count refreshes when reopening with cached export data', async () => {
  const latest = createDeferred()
  const preview = createDeferred()
  let refreshing = false
  let latestReads = 0
  onTestFinished(() => {
    latest.resolve()
    preview.resolve()
  })
  const { trigger, dialog, previews, requests } = await openExport(false, 'chat', {
    waitForLatest: () => {
      latestReads++
      return refreshing ? latest.promise : undefined
    },
    waitForPreview: () => (refreshing ? preview.promise : undefined),
  })
  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
  await trigger.click()
  await expect.element(submit).toBeEnabled()
  const initialPreviewReads = previews.length
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()

  refreshing = true
  await trigger.click()
  await expect.poll(() => latestReads).toBe(2)
  await expect.element(submit).toBeDisabled()
  latest.resolve()
  await expect.poll(() => previews.length).toBe(initialPreviewReads + 1)
  await expect.element(submit).toBeDisabled()
  preview.resolve()
  await expect.element(submit).toBeEnabled()
  expect(requests).toEqual([])
})

it.each(['response-lost', 'active-export'] as const)(
  'recovers an existing export after a %s submission failure',
  async (createFailure) => {
    const { trigger, dialog, lastExport, requests } = await openExport(false, 'chat', {
      createFailure,
    })
    await trigger.click()
    const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
    await submit.click()

    await expect
      .element(lastExport.getByRole('status'))
      .toHaveTextContent('appLog.archives.downloadHint.preparing')
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.exporting' }))
      .toBeDisabled()
    await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
    await expect
      .element(lastExport.getByRole('button', { name: 'common.operation.download' }))
      .toBeEnabled()
    await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
    expect(requests).toHaveLength(1)
  },
)

it('shows the last export filters in its own row after the user leaves and returns', async () => {
  const { screen, trigger, dialog, lastExport, renderLogs, requests } = await openExport()
  await trigger.click()
  const period = dialog.getByRole('combobox', { name: 'appLog.export.timeRange' })
  await period.click()
  await page.getByRole('option', { name: 'appLog.filter.period.last4weeks' }).click()
  const identities = dialog.getByRole('combobox', { name: 'appLog.table.header.endUser' })
  await identities.click()
  await page.getByRole('option', { name: 'user-1024' }).click()
  await userEvent.keyboard('{Escape}')
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()

  await expect.element(progressDownload).toBeEnabled()
  await progressClose.click()
  await expect.element(progressDialog).not.toBeInTheDocument()
  await screen.unmount()
  const reopened = await renderLogs()
  await reopened.trigger.click()
  await expect.element(period).toHaveTextContent('appLog.filter.period.last7days')
  await expect.element(identities).toHaveTextContent('appLog.export.identitiesAll')
  const { start, end } = requests[0]!
  await expect.element(lastExport.getByText(`${start} – ${end}`)).toBeVisible()
  await expect.element(lastExport.getByText(/user-1024/)).toBeVisible()
  await expect
    .element(lastExport.getByRole('button', { name: 'common.operation.download' }))
    .toBeEnabled()
})

it('can select identities beyond the visible Logs page when exporting legacy Agent logs', async () => {
  const { trigger, dialog, previews, requests } = await openExport(false, 'agent-chat')
  await trigger.click()
  const period = dialog.getByRole('combobox', { name: 'appLog.export.timeRange' })
  await expect.element(period).toHaveTextContent('appLog.filter.period.last7days')
  const identityLabel = 'appLog.table.header.endUser'
  await dialog.getByRole('combobox', { name: identityLabel }).click()
  const picker = page.getByRole('dialog', { name: identityLabel })
  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
  await picker.getByRole('option', { name: 'user-1024' }).click()
  await expect.element(dialog.getByRole('status')).toHaveTextContent('Conversation 1 · CSV rows 2.')
  await picker.getByRole('option', { name: 'Mia Chen' }).click()
  await expect
    .element(picker.getByRole('button', { name: 'common.operation.clear' }))
    .not.toBeInTheDocument()
  const search = picker.getByRole('combobox', { name: 'common.operation.search' })
  await search.fill('42')
  await picker.getByRole('option', { name: olderEndUser.label }).click()
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('Conversations 3 · CSV rows 6.')
  await expect.element(submit).toBeEnabled()
  expect(previews.at(-1)?.getAll('end_user_ids')).toEqual([endUserId, olderEndUser.id])
  expect(previews.at(-1)?.getAll('account_ids')).toEqual([accountId])
  expect(previews.at(-1)?.has('start')).toBe(true)
  expect(previews.at(-1)?.has('end')).toBe(true)
  await search.click()
  await userEvent.keyboard('{Enter}')
  expect(requests).toEqual([])
  await userEvent.keyboard('{Escape}')
  await dialog.getByRole('combobox', { name: identityLabel }).click()
  await expect.element(search).toHaveValue('')
  await expect.element(picker.getByRole('option', { name: 'user-1024' })).toBeVisible()
  await dialog.getByRole('heading', { name: 'appLog.export.title' }).click()
  await period.click()
  await page.getByRole('option', { name: 'appLog.filter.period.allTime' }).click()
  await expect.poll(() => previews.at(-1)?.has('start')).toBe(false)
  expect(previews.at(-1)?.has('end')).toBe(false)
})

it('keeps the export dialog height stable while recounting after an identity change', async () => {
  await page.viewport(768, 900)
  const recount = createDeferred()
  onTestFinished(() => recount.resolve())
  const { trigger, dialog } = await openExport(false, 'advanced-chat', {
    waitForPreview: (query) => (query.has('end_user_ids') ? recount.promise : undefined),
  })
  await trigger.click()
  const count = dialog.getByRole('status')
  await expect.element(count).toHaveTextContent('Conversations 2 · CSV rows 4.')
  expect(count.element().parentElement?.textContent).toBe(
    `Conversations 2 · CSV rows 4. ${appLogCopy['export.previewChatflowDescription']}`,
  )
  const dialogHeight = () => (dialog.element() as HTMLElement).offsetHeight
  const initialHeight = dialogHeight()

  await dialog.getByRole('combobox', { name: 'appLog.table.header.endUser' }).click()
  await page.getByRole('option', { name: 'user-1024' }).click()
  await expect.element(count).toHaveTextContent('appLog.detail.loading…')
  await expect.element(dialog.getByRole('button', { name: 'appLog.export.submit' })).toBeDisabled()
  expect(dialogHeight()).toBe(initialHeight)

  recount.resolve()
  await expect.element(count).toHaveTextContent('Conversation 1 · CSV rows 2.')
  expect(dialogHeight()).toBe(initialHeight)
})

it('shares the Chatflow list filters with export while keeping a separate export draft', async () => {
  const { screen, trigger, dialog, lastExport, listQueries, previews, requests, renderLogs } =
    await openExport(false, 'advanced-chat')
  const identityLabel = 'appLog.table.header.endUser'
  const listIdentity = screen.getByRole('combobox', { name: identityLabel })
  const listSearch = screen.getByPlaceholder('common.operation.search')
  const identitySearch = page
    .getByRole('dialog', { name: identityLabel })
    .getByRole('combobox', { name: 'common.operation.search' })
  const listFieldHeight = () => listIdentity.element().getBoundingClientRect().height
  const endUserOption = page.getByRole('option', { name: 'user-1024' })
  const accountOption = page.getByRole('option', { name: 'Mia Chen' })
  const firstTwoIdentities = 'user-1024, Mia Chen'

  await expect.element(listIdentity).toHaveAttribute('type', 'button')
  const initialHeight = listFieldHeight()
  await expect.element(identitySearch).not.toBeInTheDocument()
  await listIdentity.click()
  await identitySearch.fill('1024')
  await endUserOption.click()
  await expect.element(listIdentity).toHaveAttribute('aria-expanded', 'true')
  await expect.element(identitySearch).toHaveValue('1024')
  await identitySearch.fill('')
  await accountOption.click()
  await expect.element(listIdentity).toHaveAttribute('aria-expanded', 'true')
  await expect.element(listIdentity.getByText(firstTwoIdentities, { exact: true })).toBeVisible()
  expect(listFieldHeight()).toBe(initialHeight)
  expect(listQueries.at(-1)?.has('end_user_ids')).toBe(false)
  expect(listQueries.at(-1)?.has('account_ids')).toBe(false)

  await accountOption.click()
  await screen.getByText('appLog.title', { exact: true }).click()
  await expect.poll(() => listQueries.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  await expect
    .element(screen.getByText('Change the email on my account', { exact: true }))
    .not.toBeInTheDocument()

  await listSearch.fill('refund')
  await expect.poll(() => listQueries.at(-1)?.get('keyword')).toBe('refund')
  await screen.getByRole('button', { name: /common.sorting.sortBy/ }).click()
  await page.getByRole('menuitemradio', { name: 'appLog.table.header.updatedTime' }).click()
  await expect.poll(() => listQueries.at(-1)?.get('sort_by')).toBe('-updated_at')

  await listIdentity.click()
  await accountOption.click()
  await expect.element(listIdentity).toHaveAttribute('aria-expanded', 'true')
  expect(listQueries.at(-1)?.has('account_ids')).toBe(false)
  await screen.getByText('appLog.export.title', { exact: true }).click()
  await expect.poll(() => listQueries.at(-1)?.getAll('account_ids')).toEqual([accountId])
  expect(listQueries.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  const exportIdentity = dialog.getByRole('combobox', { name: identityLabel })
  await expect.element(exportIdentity).toBeVisible()
  const exportFieldHeight = () => exportIdentity.element().getBoundingClientRect().height
  const initialExportHeight = exportFieldHeight()
  const twoVisibleIdentities = exportIdentity.getByText(firstTwoIdentities, { exact: true })
  await expect.element(twoVisibleIdentities).toBeVisible()
  await expect.element(dialog.getByPlaceholder('common.operation.search')).not.toBeInTheDocument()
  await expect
    .element(dialog.getByRole('button', { name: /common.sorting.sortBy/ }))
    .not.toBeInTheDocument()
  await expect
    .element(dialog.getByText(appLogCopy['export.previewChatflowDescription'], { exact: true }))
    .toBeVisible()
  expect(previews.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  expect(previews.at(-1)?.getAll('account_ids')).toEqual([accountId])
  expect(previews.at(-1)?.has('keyword')).toBe(false)
  expect(previews.at(-1)?.get('sort_by')).toBe('-updated_at')

  await exportIdentity.click()
  await identitySearch.fill('42')
  await page.getByRole('option', { name: olderEndUser.label }).click()
  await expect
    .poll(() => previews.at(-1)?.getAll('end_user_ids'))
    .toEqual([endUserId, olderEndUser.id])
  const allIdentities = exportIdentity.getByText('user-1024, Mia Chen, customer-42', {
    exact: true,
  })
  await expect.element(allIdentities).toBeVisible()
  expect(exportFieldHeight()).toBe(initialExportHeight)
  expect(listQueries.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  await userEvent.keyboard('{Escape}')
  await expect.element(exportIdentity).toHaveAttribute('aria-expanded', 'false')

  const { innerWidth, innerHeight } = window
  await page.viewport(280, innerHeight)
  await expect.element(exportIdentity.getByText('user-1024', { exact: true }).first()).toBeVisible()
  await expect.element(exportIdentity.getByText('+2', { exact: true }).first()).toBeVisible()
  expect(exportFieldHeight()).toBe(initialExportHeight)
  await page.viewport(innerWidth, innerHeight)
  await expect.element(allIdentities).toBeVisible()

  await dialog.getByRole('combobox', { name: 'appLog.export.timeRange' }).click()
  await page.getByRole('option', { name: 'appLog.filter.period.allTime' }).click()
  await expect.poll(() => previews.at(-1)?.has('start')).toBe(false)
  expect(listQueries.at(-1)?.has('start')).toBe(true)

  await dialog.getByRole('combobox', { name: 'appLog.table.header.status' }).click()
  await page.getByRole('option', { name: 'appLog.filter.annotation.not_annotated' }).click()
  await expect.poll(() => previews.at(-1)?.get('annotation_status')).toBe('not_annotated')
  expect(listQueries.at(-1)?.get('annotation_status')).toBe('all')

  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
  await expect.element(submit).toBeEnabled()
  await submit.click()
  await expect.element(progressDownload).toBeEnabled()
  await progressClose.click()
  await expect.element(progressDialog).not.toBeInTheDocument()
  await trigger.click()
  const savedIdentities = lastExport.getByText('user-1024, customer-42, Mia Chen', { exact: true })
  await expect.element(savedIdentities).toBeVisible()
  await expect
    .poll(() => requests)
    .toEqual([
      {
        annotation_status: 'not_annotated',
        estimated_rows: 6,
        end_user_ids: [endUserId, olderEndUser.id],
        account_ids: [accountId],
        identity_labels: [
          { id: endUserId, label: 'user-1024', source: 'end-user' },
          { id: accountId, label: 'Mia Chen', source: 'account' },
          olderEndUser,
        ],
        sort_by: '-updated_at',
      },
    ])

  await dialog.getByRole('button', { name: 'common.operation.close', exact: true }).first().click()
  await expect.element(dialog).not.toBeInTheDocument()
  await trigger.click()
  await expect.element(exportIdentity.getByText(firstTwoIdentities, { exact: true })).toBeVisible()
  await expect.element(savedIdentities).toBeVisible()

  await exportIdentity.click()
  await accountOption.click()
  await userEvent.keyboard('{Escape}')
  await expect.element(exportIdentity.getByText('user-1024', { exact: true })).toBeVisible()
  await expect.element(savedIdentities).toBeVisible()

  await screen.unmount()
  const reopened = await renderLogs()
  await reopened.trigger.click()
  await expect.element(savedIdentities).toBeVisible()
})
