import type { NodePanelPresenceMap } from '@/app/components/workflow/collaboration/types/collaboration'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { onTestFinished } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { getUserColor } from '@/app/components/workflow/collaboration/utils/user-color'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderWorkflowBrowserComponent } from '../../../__tests__/workflow-browser-test-env'
import { BlockEnum } from '../../../types'
import BaseNode from '../node'

const presence: NodePanelPresenceMap = {
  llm: {
    'client-ralph': {
      clientId: 'client-ralph',
      userId: 'ralph',
      username: 'Ralph Edwards',
      timestamp: 2,
    },
    'client-me': { clientId: 'client-me', userId: 'me', username: 'Me', timestamp: 3 },
  },
}

// boundary: supply fixed panel presence without connecting to the collaboration server.
vi.mock('@/app/components/workflow/collaboration/hooks/use-collaboration', () => ({
  useCollaboration: () => ({ isConnected: true, nodePanelPresence: presence }),
}))

it('shows who else is editing a node in their collaborator color', async () => {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(800, 600)
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'me', name: 'Me', avatar_url: null },
  })
  seedAppDslVersion(queryClient)
  const screen = await renderWorkflowBrowserComponent(
    <TooltipProvider>
      <div style={{ padding: 40 }}>
        <BaseNode id="llm" data={{ type: BlockEnum.Code, title: 'LLM', desc: '', selected: false }}>
          <div>Node content</div>
        </BaseNode>
      </div>
    </TooltipProvider>,
    { queryClient },
  )

  const avatar = screen.getByRole('img', {
    name: 'workflow.collaboration.userEditing:{"name":"Ralph Edwards"}',
  })
  await expect.element(avatar).toBeVisible()
  await expect
    .element(avatar.getByText('R'))
    .toHaveStyle({ backgroundColor: getUserColor('ralph') })
  await expect
    .element(screen.getByRole('img', { name: 'workflow.collaboration.userEditing:{"name":"Me"}' }))
    .not.toBeInTheDocument()

  await userEvent.hover(avatar)
  await expect
    .element(screen.getByText('workflow.collaboration.userEditing:{"name":"Ralph Edwards"}'))
    .toBeVisible()
})
