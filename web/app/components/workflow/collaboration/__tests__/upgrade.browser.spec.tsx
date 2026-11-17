import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderWorkflowBrowserComponent } from '../../__tests__/workflow-browser-test-env'
import OnlineUsers from '../../header/online-users'
import Control from '../../operator/control'
import { CollaborationUpgradeModal } from '../upgrade-modal'

const avatarLabel = 'billing.upgrade.workflowCollaboration.label'
const commentLabel = 'workflow.common.commentMode'
const upgradeTitle = 'billing.upgrade.workflowCollaboration.title'

async function renderEditorControls(
  plan: 'sandbox' | 'team',
  deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'CLOUD',
) {
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { name: 'Ada', avatar_url: null },
    appDslVersion: '0.6.0',
    features: { billing: { subscription: { plan } }, workflow_collaboration_enabled: false },
    systemFeatures: { deployment_edition: deploymentEdition },
  })
  const onUrlUpdate = vi.fn()
  const screen = await renderWorkflowBrowserComponent(
    <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
      <TooltipProvider>
        <OnlineUsers />
        <Control />
        <CollaborationUpgradeModal />
      </TooltipProvider>
    </NuqsTestingAdapter>,
    { queryClient },
  )
  return { screen, onUrlUpdate }
}

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})

it('offers the same upgrade from the current account avatar and the comment button', async () => {
  const { screen, onUrlUpdate } = await renderEditorControls('sandbox')
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

  const comment = screen.getByRole('button', { name: commentLabel })
  await comment.click()
  await expect.element(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'billing.triggerLimitModal.upgrade' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(() => onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open')
})

it.each([
  ['team', 'CLOUD'],
  ['sandbox', 'COMMUNITY'],
] as const)(
  'hides both upgrade controls for %s on %s without collaboration',
  async (plan, edition) => {
    const { screen } = await renderEditorControls(plan, edition)

    await expect.element(screen.getByRole('button', { name: avatarLabel })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: commentLabel })).not.toBeInTheDocument()
  },
)
