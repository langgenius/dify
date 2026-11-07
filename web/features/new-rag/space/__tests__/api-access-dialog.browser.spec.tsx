import type { ComponentProps } from 'react'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { KnowledgeFsApiAccessDialog } from '../api-access-dialog'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.apiKeys.get': async () => ({
        data: [
          {
            id: 'workspace-key',
            token: 'dataset-existing-secret',
            created_at: 1710000000,
            last_used_at: null,
            type: 'dataset',
            dataset_ids: [],
            knowledge_space_ids: [],
          },
        ],
      }),
      'datasets.apiBaseInfo.get': async () => ({ api_base_url: 'https://api.example.com/v1/' }),
    }),
  }
})

async function renderDialog(
  props: Omit<ComponentProps<typeof KnowledgeFsApiAccessDialog>, 'onOpenChange' | 'open'>,
  workspacePermissionKeys: string[] = ['dataset.api_key.manage'],
) {
  function Viewer() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open API access
        </button>
        <KnowledgeFsApiAccessDialog {...props} open={open} onOpenChange={setOpen} />
      </>
    )
  }
  const { wrapper: QueryProvider } = createConsoleQueryWrapper({ workspacePermissionKeys })
  return render(
    <QueryProvider>
      <Viewer />
    </QueryProvider>,
  )
}

describe('KnowledgeFsApiAccessDialog', () => {
  beforeEach(async () => {
    await page.viewport(800, 700)
    onTestFinished(guardUnexpectedFetch())
  })

  it('moves from Service API details to workspace keys and reopens a fresh dialog', async () => {
    const user = userEvent
    const screen = await renderDialog({ status: 'active', knowledgeSpaceId: 'space-1' })
    const opener = screen.getByRole('button', { name: 'Open API access' })

    await opener.click()
    let serviceDialog = screen.getByRole('dialog', { name: 'knowledgeSpace.apiAgentAccess' })
    await expect.element(serviceDialog).toBeVisible()
    expect(serviceDialog.element().contains(document.activeElement)).toBe(true)
    await expect
      .element(serviceDialog.getByText('https://api.example.com/v1/knowledge-fs/spaces/space-1'))
      .toBeVisible()

    await user.click(serviceDialog.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }))
    await expect.element(serviceDialog).not.toBeInTheDocument()
    const keyDialog = screen.getByRole('dialog', { name: 'appApi.apiKeyModal.apiSecretKey' })
    await expect.element(keyDialog).toBeVisible()
    expect(keyDialog.element().contains(document.activeElement)).toBe(true)
    await expect.element(keyDialog.getByText('datas...cret')).toBeVisible()
    await expect
      .element(keyDialog.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }))
      .toBeEnabled()

    await user.keyboard('{Escape}')
    await expect.element(keyDialog).not.toBeInTheDocument()
    await expect.element(opener).toHaveFocus()

    await user.keyboard('{Enter}')
    serviceDialog = screen.getByRole('dialog', { name: 'knowledgeSpace.apiAgentAccess' })
    await expect.element(serviceDialog).toBeVisible()
    await expect
      .element(serviceDialog.getByText('https://api.example.com/v1/knowledge-fs/spaces/space-1'))
      .toBeVisible()
  })

  it('shows inactive access without exposing workspace key management', async () => {
    const screen = await renderDialog({ status: 'inactive', knowledgeSpaceId: 'space-1' })
    await screen.getByRole('button', { name: 'Open API access' }).click()

    const dialog = screen.getByRole('dialog', { name: 'knowledgeSpace.apiAgentAccess' })
    await expect.element(dialog.getByText('knowledgeSpace.apiAccessInactive')).toBeVisible()
    await expect
      .element(dialog.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }))
      .not.toBeInTheDocument()
  })

  it('keeps the endpoint visible but makes key management read-only without permission', async () => {
    const screen = await renderDialog({ status: 'active', knowledgeSpaceId: 'space-1' }, [])
    await screen.getByRole('button', { name: 'Open API access' }).click()

    const dialog = screen.getByRole('dialog', { name: 'knowledgeSpace.apiAgentAccess' })
    await expect.element(dialog.getByText('knowledgeSpace.settings.viewOnly')).toBeVisible()
    await expect
      .element(dialog.getByText('https://api.example.com/v1/knowledge-fs/spaces/space-1'))
      .toBeVisible()
    await expect
      .element(dialog.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }))
      .not.toBeInTheDocument()
  })
})
