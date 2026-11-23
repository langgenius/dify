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
      { user_id: 'bob', username: 'Bob', sid: 'sid-bob', avatar: null },
      { user_id: 'carol', username: 'Carol', sid: 'sid-carol', avatar: null },
      { user_id: 'dana', username: 'Dana', sid: 'sid-dana', avatar: null },
      { user_id: 'eve', username: 'Eve', sid: 'sid-eve', avatar: null },
    ],
  }),
}))

it('shows a current avatar even when the collaboration session has no avatar snapshot', async () => {
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
  const trigger = screen.getByRole('button', {
    name: 'workflow.collaboration.viewCollaborators:{"count":4}',
  })
  await expect.element(trigger.getByAltText('').first()).toBeVisible()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect.element(screen.getByRole('button', { name: 'Dana' }).getByAltText('')).toBeVisible()
})

it('keeps the last visible avatars when a room refresh fails', async () => {
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
    .mockResolvedValue({ 'sid-bob': avatarUrl })
  onTestFinished(() => getOnlineUserAvatars.mockRestore())
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })

  const screen = await renderWorkflowBrowserComponent(
    <TooltipProvider>
      <OnlineUsers />
    </TooltipProvider>,
    { resource: { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: true } },
  )
  await vi.advanceTimersByTimeAsync(0)
  const bobAvatar = screen
    .getByRole('button', { name: 'workflow.collaboration.viewCollaborators:{"count":4}' })
    .getByAltText('')
    .first()
  await expect.element(bobAvatar).toBeVisible()

  vi.clearAllTimers()
  const trigger = screen.getByRole('button', {
    name: 'workflow.collaboration.viewCollaborators:{"count":4}',
  })
  const callsBeforeOpen = getOnlineUserAvatars.mock.calls.length
  await trigger.click()
  await expect.poll(() => getOnlineUserAvatars.mock.calls.length).toBe(callsBeforeOpen + 1)
  const callsBeforeRefresh = getOnlineUserAvatars.mock.calls.length
  getOnlineUserAvatars.mockRejectedValueOnce(new Error('avatar acknowledgement timed out'))
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersToNextTimerAsync()
  expect(getOnlineUserAvatars).toHaveBeenCalledTimes(callsBeforeRefresh + 1)
  await expect(getOnlineUserAvatars.mock.results.at(-1)?.value).rejects.toThrow(
    'avatar acknowledgement timed out',
  )
  await vi.advanceTimersByTimeAsync(0)
  await expect.element(bobAvatar).toBeVisible()
})
