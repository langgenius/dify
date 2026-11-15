import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { datasetsPage, members, setup, space, spacesPage } from './new-knowledge-list-test-env'

const api = vi.hoisted(() => ({
  spaces: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>(),
  deleteSpace: vi.fn<typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.delete>(),
  members: vi.fn<typeof consoleClient.workspaces.current.members.get>(),
  upgradeJobs: vi.fn<typeof consoleClient.datasets.knowledgeFsUpgradeJobs.get>(),
  upgradeJob: vi.fn<typeof consoleClient.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get>(),
  datasets: vi.fn<typeof consoleClient.datasets.get>(),
  push: vi.fn(),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.get': api.spaces,
      'knowledgeFs.spaces.byControlSpaceId.delete': api.deleteSpace,
      'workspaces.current.members.get': api.members,
      'datasets.knowledgeFsUpgradeJobs.get': api.upgradeJobs,
      'datasets.get': api.datasets,
      'datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get': api.upgradeJob,
      'datasets.apiBaseInfo.get': async () => ({ api_base_url: 'https://api.example.com' }),
      'datasets.externalKnowledgeApi.get': async () => ({
        data: [],
        has_more: false,
        limit: 100,
        page: 1,
        total: 0,
      }),
      'tags.get': async () => [
        { binding_count: '1', id: 'tag-1', name: 'Customer support', type: 'knowledge' },
        { binding_count: '1', id: 'tag-2', name: 'Public docs', type: 'knowledge' },
      ],
    }),
  }
})

describe('NewKnowledgeList card actions', () => {
  beforeEach(async () => {
    await page.viewport(1000, 760)
    onTestFinished(guardUnexpectedFetch())
    api.spaces.mockResolvedValue(spacesPage())
    api.deleteSpace.mockResolvedValue({ result: 'success' })
    api.members.mockResolvedValue({ accounts: members })
    api.upgradeJobs.mockResolvedValue({ data: [] })
    api.upgradeJob.mockImplementation(() => new Promise(() => {}))
    api.datasets.mockResolvedValue(datasetsPage([]))
  })

  describe('card actions', () => {
    it('keeps card actions outside the link and opens edit settings', async () => {
      const user = userEvent
      api.spaces.mockResolvedValue(
        spacesPage([
          space('space-1', 'Support knowledge', {
            permission_keys: [
              'knowledge_space_delete',
              'knowledge_space_edit',
              'knowledge_space_read',
            ],
          }),
        ]),
      )
      await setup()

      const cardLink = page.getByRole('link', { name: 'Support knowledge' })
      const actions = page.getByRole('button', { name: 'common.operation.more' })
      await expect.element(cardLink.getByRole('button')).not.toBeInTheDocument()

      await user.click(actions)

      await expect
        .element(page.getByRole('menuitem', { name: 'common.operation.edit' }))
        .toHaveAttribute('href', '/datasets/new/space-1/settings')
    })

    it('deletes after the exact name is confirmed and refreshes the collection', async () => {
      const user = userEvent
      api.spaces
        .mockResolvedValueOnce(
          spacesPage([
            space('space-1', 'Support knowledge', {
              permission_keys: ['knowledge_space_delete', 'knowledge_space_read'],
            }),
          ]),
        )
        .mockResolvedValue(spacesPage())
      await setup()

      await user.click(page.getByRole('button', { name: 'common.operation.more' }))
      await user.click(page.getByRole('menuitem', { name: 'common.operation.delete' }))
      const dialog = page.getByRole('alertdialog')
      const confirmation = dialog.getByRole('textbox')
      await expect.element(confirmation).toHaveFocus()
      const deleteButton = dialog.getByRole('button', { name: 'common.operation.confirm' })

      await user.type(confirmation, 'Support')
      await expect.element(deleteButton).toBeDisabled()
      await user.type(confirmation, ' knowledge')
      await user.click(deleteButton)

      await expect.element(dialog).not.toBeInTheDocument()
      await expect
        .element(page.getByRole('link', { name: 'Support knowledge' }))
        .not.toBeInTheDocument()
      await expect.element(page.getByRole('region', { name: 'knowledgeSpace.new' })).toHaveFocus()
      expect(api.deleteSpace).toHaveBeenCalledWith({ params: { control_space_id: 'space-1' } })
    })

    it('keeps the confirmation open with the failure when deletion fails', async () => {
      const user = userEvent
      api.spaces.mockResolvedValue(
        spacesPage([
          space('space-1', 'Support knowledge', {
            permission_keys: ['knowledge_space_delete', 'knowledge_space_read'],
          }),
        ]),
      )
      api.deleteSpace.mockRejectedValueOnce(new Error('network down'))
      await setup()

      await user.click(page.getByRole('button', { name: 'common.operation.more' }))
      await user.click(page.getByRole('menuitem', { name: 'common.operation.delete' }))
      const dialog = page.getByRole('alertdialog')
      const confirmation = dialog.getByRole('textbox')
      await confirmation.fill('Support knowledge')
      await expect.element(confirmation).toHaveValue('Support knowledge')
      await user.keyboard('{Enter}')

      await expect.element(dialog.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
      await expect.element(confirmation).toHaveValue('Support knowledge')
      await expect.element(dialog).toBeVisible()
    })
  })
})
