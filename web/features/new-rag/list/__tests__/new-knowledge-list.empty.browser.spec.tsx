import { page } from 'vite-plus/test/browser'
import { installFakeApi, pendingResponse } from '@/test/fake-api'
import { datasetsPage, members, setup, spacesPage } from './new-knowledge-list-test-env'

function installListApi() {
  return installFakeApi({
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
  })
}

describe('NewKnowledgeList empty workspace', () => {
  beforeEach(async () => {
    await page.viewport(1000, 760)
    onTestFinished(installListApi())
  })

  describe('empty workspace', () => {
    it('links available creation modes', async () => {
      await setup()

      const connectSource = page.getByRole('link', {
        name: 'knowledgeSpace.connectSource',
      })
      await expect
        .element(connectSource)
        .toHaveAttribute('href', '/datasets/new/create?start=source')
      await expect
        .element(connectSource)
        .toHaveAccessibleDescription(
          'knowledgeSpace.connectSourceDescription dataset.firstEmpty.recommended',
        )
      await expect
        .element(page.getByRole('link', { name: 'knowledgeSpace.uploadFiles' }))
        .toHaveAttribute('href', '/datasets/new/create?start=upload')
      await expect
        .element(page.getByRole('link', { name: 'knowledgeSpace.startEmpty' }))
        .toHaveAttribute('href', '/datasets/new/create?start=empty')
      await expect
        .element(page.getByRole('link', { name: 'common.operation.create' }))
        .toHaveAttribute('href', '/datasets/new/create')
    })

    it('keeps upload unavailable when KnowledgeFS upload is disabled', async () => {
      await setup({ knowledgeFsFeatures: { upload_enabled: false } })

      const uploadFiles = page.getByRole('button', { name: 'knowledgeSpace.uploadFiles' })
      await expect.element(uploadFiles).toBeDisabled()
      await expect
        .element(uploadFiles)
        .toHaveAccessibleDescription(
          'knowledgeSpace.uploadFilesDescription dataset.cornerLabel.unavailable',
        )
    })

    it.each([
      ['external-connect only', ['dataset.external.connect']],
      ['read-only', []],
    ])('hides creation entries from %s users', async (_, workspacePermissionKeys) => {
      await setup({ workspacePermissionKeys })

      await expect.element(page.getByText('knowledgeSpace.readOnlyEmpty')).toBeInTheDocument()
      await expect
        .element(page.getByRole('link', { name: 'common.operation.create' }))
        .not.toBeInTheDocument()
      await expect
        .element(page.getByRole('link', { name: 'knowledgeSpace.connectSource' }))
        .not.toBeInTheDocument()
    })
  })
})
