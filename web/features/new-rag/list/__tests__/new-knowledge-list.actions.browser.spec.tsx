import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { apiError, installFakeApi } from '@/test/fake-api'
import { datasetsPage, members, setup, space, spacesPage } from './new-knowledge-list-test-env'

const api = {
  spaces: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>(),
  deleteSpace: vi.fn<typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.delete>(),
  members: vi.fn<typeof consoleClient.workspaces.current.members.get>(),
  upgradeJobs: vi.fn<typeof consoleClient.datasets.knowledgeFsUpgradeJobs.get>(),
  upgradeJob: vi.fn<typeof consoleClient.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get>(),
  datasets: vi.fn<typeof consoleClient.datasets.get>(),
}

describe('NewKnowledgeList card actions', () => {
  beforeEach(async () => {
    await page.viewport(1000, 760)
    onTestFinished(
      installFakeApi({
        console: {
          knowledgeFs: {
            spaces: {
              get: (input) => api.spaces(input),
              byControlSpaceId: {
                delete: async (input) => {
                  await api.deleteSpace(input)
                },
              },
            },
          },
          workspaces: { current: { members: { get: (input) => api.members(input) } } },
          datasets: {
            get: (input) => api.datasets(input),
            knowledgeFsUpgradeJobs: { get: (input) => api.upgradeJobs(input) },
            byDatasetId: {
              knowledgeFsUpgrades: { byJobId: { get: (input) => api.upgradeJob(input) } },
            },
            apiBaseInfo: { get: () => ({ api_base_url: 'https://api.example.com' }) },
            externalKnowledgeApi: {
              get: () => ({ data: [], has_more: false, limit: 100, page: 1, total: 0 }),
            },
          },
          tags: {
            get: () => [
              { binding_count: '1', id: 'tag-1', name: 'Customer support', type: 'knowledge' },
              { binding_count: '1', id: 'tag-2', name: 'Public docs', type: 'knowledge' },
            ],
          },
        },
      }),
    )
    api.spaces.mockResolvedValue(spacesPage())
    api.deleteSpace.mockResolvedValue(undefined)
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
      api.deleteSpace.mockRejectedValueOnce(apiError('SERVICE_UNAVAILABLE', 503, 'network down'))
      await setup()

      await user.click(page.getByRole('button', { name: 'common.operation.more' }))
      await user.click(page.getByRole('menuitem', { name: 'common.operation.delete' }))
      const dialog = page.getByRole('alertdialog')
      const confirmation = dialog.getByRole('textbox')
      await confirmation.fill('Support knowledge')
      await expect.element(confirmation).toHaveValue('Support knowledge')
      await user.keyboard('{Enter}')

      // The server's reason is shown in place of the generic failure message.
      await expect.element(dialog.getByRole('alert')).toHaveTextContent('network down')
      await expect.element(confirmation).toHaveValue('Support knowledge')
      await expect.element(dialog).toBeVisible()
    })
  })
})
