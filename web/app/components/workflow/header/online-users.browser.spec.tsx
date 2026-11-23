import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderWorkflowBrowserComponent } from '../__tests__/workflow-browser-test-env'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import OnlineUsers from './online-users'

// boundary: supply a connected roster without starting the workflow canvas or its CRDT runtime.
vi.mock('../collaboration/hooks/use-collaboration', () => ({
  useCollaboration: () => ({
    isConnected: true,
    isEnabled: true,
    cursors: {},
    onlineUsers: [
      { user_id: 'bob', username: 'Bob', sid: 'sid-bob', avatar: 'bob-upload-id' },
      { user_id: 'carol', username: 'Carol', sid: 'sid-carol', avatar: null },
      { user_id: 'dana', username: 'Dana', sid: 'sid-dana', avatar: 'dana-upload-id' },
      { user_id: 'eve', username: 'Eve', sid: 'sid-eve', avatar: null },
    ],
  }),
}))

it('shows a collaborator’s uploaded avatar and refreshes URLs when opening the member list', async () => {
  onTestFinished(guardUnexpectedFetch())
  const avatarUrl = URL.createObjectURL(
    new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>'], {
      type: 'image/svg+xml',
    }),
  )
  onTestFinished(() => URL.revokeObjectURL(avatarUrl))
  // boundary: replace only the authorized room’s avatar response.
  const getOnlineUserAvatars = vi
    .spyOn(collaborationManager, 'getOnlineUserAvatars')
    .mockResolvedValueOnce({ 'sid-bob': avatarUrl })
    .mockResolvedValue({ 'sid-bob': avatarUrl, 'sid-dana': avatarUrl })
  onTestFinished(() => getOnlineUserAvatars.mockRestore())

  const screen = await renderWorkflowBrowserComponent(
    <TooltipProvider>
      <OnlineUsers />
    </TooltipProvider>,
    { resource: { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: true } },
  )
  await expect.element(screen.getByRole('button', { name: 'Bob' }).getByAltText('')).toBeVisible()
  await screen.getByText('+2').click()
  await expect.element(screen.getByRole('button', { name: 'Dana' }).getByAltText('')).toBeVisible()
})
