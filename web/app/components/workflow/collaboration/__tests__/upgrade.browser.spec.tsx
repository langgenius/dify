import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vitest/browser'
import { trackEvent } from '@/app/components/base/amplitude'
import { Pricing } from '@/app/components/billing/pricing'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderWorkflowBrowserComponent } from '../../__tests__/workflow-browser-test-env'
import OnlineUsers from '../../header/online-users'
import Control from '../../operator/control'
import { CollaborationUpgradeModal } from '../upgrade-modal'

// boundary: collaboration analytics stop at the telemetry adapter.
vi.mock('@/app/components/base/amplitude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/amplitude')>()),
  trackEvent: vi.fn(),
}))

const avatarLabel = 'billing.upgrade.workflowCollaboration.label'
const commentLabel = 'workflow.common.commentMode'
const upgradeTitle = 'billing.upgrade.workflowCollaboration.title'

async function renderEditorControls({ upgradeAvailable = true, showPricing = false } = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { name: 'Ada', avatar_url: null },
    appDslVersion: '0.6.0',
    features: {
      billing: { subscription: { plan: 'sandbox' } },
      workflow_collaboration_upgrade_available: upgradeAvailable,
    },
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  const screen = await renderWorkflowBrowserComponent(
    <NuqsTestingAdapter hasMemory>
      <TooltipProvider>
        <OnlineUsers />
        <Control />
        <CollaborationUpgradeModal />
        {showPricing && <Pricing />}
      </TooltipProvider>
    </NuqsTestingAdapter>,
    { queryClient },
  )
  return { screen, queryClient }
}

beforeEach(() => {
  vi.clearAllMocks()
  onTestFinished(guardUnexpectedFetch())
})

it('offers the same dialog from the avatar and comment icon and restores focus to each opener', async () => {
  const { screen } = await renderEditorControls()
  const avatar = screen.getByRole('button', { name: avatarLabel })
  await expect.element(avatar.getByText('A')).toBeVisible()
  await avatar.hover()
  await expect.element(screen.getByText(avatarLabel)).toBeVisible()

  const dialog = screen.getByRole('dialog', { name: upgradeTitle })
  await avatar.click()
  await expect.element(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(avatar).toHaveFocus()

  const upgradeComment = screen.getByRole('button', { name: upgradeTitle })
  await expect.element(screen.getByRole('button', { name: commentLabel })).not.toBeInTheDocument()
  upgradeComment.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(upgradeComment).toHaveFocus()
})

it('opens Cloud pricing from the collaboration upgrade dialog', async () => {
  const { screen } = await renderEditorControls({ showPricing: true })
  await screen.getByRole('button', { name: upgradeTitle }).click()
  const dialog = screen.getByRole('dialog', { name: upgradeTitle })
  await dialog.getByRole('button', { name: 'billing.triggerLimitModal.upgrade' }).click()

  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('dialog').getByRole('button', { name: 'common.operation.close' }))
    .toBeVisible()
})

it('counts each dialog opening and the upgrade click under the control that opened it', async () => {
  const { screen } = await renderEditorControls()
  const dialog = screen.getByRole('dialog', { name: upgradeTitle })
  await screen.getByRole('button', { name: avatarLabel }).click()
  await dialog.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await screen.getByRole('button', { name: upgradeTitle }).click()
  await dialog.getByRole('button', { name: 'billing.triggerLimitModal.upgrade' }).click()

  const prompts = vi
    .mocked(trackEvent)
    .mock.calls.filter(([event]) => event === 'collab_upgrade_prompt')
    .map(([, properties]) => properties)
  expect(prompts).toEqual([
    { action: 'shown', entry_point: 'canvas_avatar', workspace_id: expect.any(String) },
    { action: 'shown', entry_point: 'canvas_comment_tool', workspace_id: expect.any(String) },
    {
      action: 'upgrade_clicked',
      entry_point: 'canvas_comment_tool',
      workspace_id: expect.any(String),
    },
  ])
})

it('hides both upgrade controls when a Sandbox workspace cannot unlock collaboration', async () => {
  const { screen } = await renderEditorControls({ upgradeAvailable: false })

  await expect.element(screen.getByRole('button', { name: avatarLabel })).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: upgradeTitle })).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: commentLabel })).not.toBeInTheDocument()
})

it('does not reopen the dialog if eligibility is lost and later restored in the same editor', async () => {
  const { screen, queryClient } = await renderEditorControls()
  const avatar = screen.getByRole('button', { name: avatarLabel })
  const dialog = screen.getByRole('dialog', { name: upgradeTitle })
  await avatar.click()
  await expect.element(dialog).toBeVisible()

  seedFeatures(queryClient, {
    billing: { subscription: { plan: 'professional' } },
    workflow_collaboration_enabled: true,
  })
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(avatar).not.toBeInTheDocument()

  seedFeatures(queryClient, { workflow_collaboration_upgrade_available: true })
  await expect.element(avatar).toBeVisible()
  await expect.element(dialog).not.toBeInTheDocument()
})
