import { page, userEvent } from 'vite-plus/test/browser'
import { apiError, pendingResponse, setupFakeApi } from '@/test/fake-api'
import { datasetsPage, members, setup, space, spacesPage } from './new-knowledge-list-test-env'

const fake = setupFakeApi(() => ({
  console: {
    knowledgeFs: {
      spaces: {
        get: async () => spacesPage(),
        byControlSpaceId: { delete: async () => {} },
      },
    },
    workspaces: { current: { members: { get: async () => ({ accounts: members }) } } },
    datasets: {
      get: async () => datasetsPage([]),
      knowledgeFsUpgradeJobs: {
        get: async () => ({ data: [] }),
      },
      byDatasetId: {
        knowledgeFsUpgrades: {
          byJobId: { get: () => pendingResponse() },
        },
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
}))

describe('NewKnowledgeList card actions', () => {
  beforeEach(async () => {
    await page.viewport(1000, 760)
  })

  describe('card actions', () => {
    it('keeps card actions outside the link and opens edit settings', async () => {
      const user = userEvent
      fake.console.knowledgeFs.spaces.get.mockResolvedValue(
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
      fake.console.knowledgeFs.spaces.get
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
      expect(fake.console.knowledgeFs.spaces.byControlSpaceId.delete).toHaveBeenCalledWith({
        params: { control_space_id: 'space-1' },
      })
    })

    it('keeps the confirmation open with the failure when deletion fails', async () => {
      const user = userEvent
      fake.console.knowledgeFs.spaces.get.mockResolvedValue(
        spacesPage([
          space('space-1', 'Support knowledge', {
            permission_keys: ['knowledge_space_delete', 'knowledge_space_read'],
          }),
        ]),
      )
      fake.console.knowledgeFs.spaces.byControlSpaceId.delete.mockRejectedValueOnce(
        apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'network down' }),
      )
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
