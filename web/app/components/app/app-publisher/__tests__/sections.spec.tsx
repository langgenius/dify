/* oxlint-disable typescript/no-explicit-any */
import type { VersionHistory } from '@/types/workflow'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import { PublisherActionsSection } from '../built-in-publisher/actions-section'
import { PublisherSummarySection } from '../built-in-publisher/summary-section'

vi.mock('../publish-with-multiple-model', () => ({
  default: ({
    disabled,
    onSelect,
  }: {
    disabled?: boolean
    onSelect: (item: Record<string, unknown>) => void
  }) => (
    <button type="button" disabled={disabled} onClick={() => onSelect({ model: 'gpt-4o' })}>
      publish-multiple-model
    </button>
  ),
}))

const createVersionInfo = (overrides: Partial<VersionHistory> = {}): VersionHistory => ({
  id: 'workflow-version-1',
  graph: {
    nodes: [],
    edges: [],
  },
  created_at: 1_710_000_000,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  hash: 'hash-1',
  updated_at: 1_710_000_000,
  updated_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  tool_published: false,
  version: '2024-03-09T16:00:00Z',
  marked_name: '',
  marked_comment: '',
  ...overrides,
})

describe('app-publisher sections', () => {
  it('should render restore controls for published chat apps', () => {
    const handleRestore = vi.fn()

    render(
      <PublisherSummarySection
        debugWithMultipleModel={false}
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '3 minutes ago'}
        handlePublish={vi.fn()}
        handleRestore={handleRestore}
        isChatApp
        multipleModelConfigs={[]}
        publishDisabled={false}
        published={false}
        publishedAt={Date.now()}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    fireEvent.click(screen.getByText(/(?:^|\.)common\.restore(?=$|:)/))
    expect(handleRestore).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(/common\.currentDraft\b/)
  })

  it('should disable publish and restore after publishing in the current open session', async () => {
    const user = userEvent.setup()
    const handleRestore = vi.fn()

    render(
      <PublisherSummarySection
        debugWithMultipleModel={false}
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '3 minutes ago'}
        handlePublish={vi.fn()}
        handleRestore={handleRestore}
        isChatApp
        multipleModelConfigs={[]}
        publishDisabled={false}
        published
        publishedAt={Date.now()}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    const restoreButton = screen.getByRole('button', {
      name: /(?:^|\.)common\.restore(?=$|:)/,
    })
    expect(restoreButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /common\.published\b/ })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/common\.upToDate\b/)
    await user.click(restoreButton)
    expect(handleRestore).not.toHaveBeenCalled()
  })

  it('should render the initial publish action when the draft has not been published yet', () => {
    render(
      <PublisherSummarySection
        debugWithMultipleModel={false}
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '1 minute ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        multipleModelConfigs={[]}
        publishDisabled={false}
        published={false}
        publishedAt={undefined}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    expect(screen.getByText(/(?:^|\.)common\.notPublishedYet(?=$|:)/)).toBeInTheDocument()
    expect(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/)).toBeInTheDocument()
    expect(screen.getByText('P')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/common\.currentDraft\b/)
  })

  it('should expose naming and keep publishing available for an unnamed published workflow', () => {
    const onEditVersion = vi.fn()

    render(
      <PublisherSummarySection
        debugWithMultipleModel={false}
        draftUpdatedAt={1_710_000_000_000}
        formatTimeFromNow={() => '17 days ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        isWorkflowApp
        multipleModelConfigs={[]}
        onEditVersion={onEditVersion}
        publishDisabled={false}
        published={false}
        publishedAt={1_710_000_100_000}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
        versionInfo={createVersionInfo({ version_number: 5 })}
      />,
    )

    expect(screen.getByText('# 5')).toBeInTheDocument()
    expect(screen.queryByText('2024-03-09T16:00:00Z')).not.toBeInTheDocument()
    const nameButton = screen.getByRole('button', {
      name: /versionHistory\.nameIt\b/,
    })
    fireEvent.click(nameButton)
    expect(onEditVersion).toHaveBeenCalledTimes(1)
    const publishButton = screen.getByRole('button', { name: /common\.publishUpdate\b/ })
    expect(publishButton).toBeEnabled()
    expect(within(publishButton).getByText('P')).toBeInTheDocument()
    expect(screen.getByText(/common\.autoSaved\b/)).toBeInTheDocument()
  })

  it('should show named workflow metadata and keep publish update available', () => {
    const onEditVersion = vi.fn()

    render(
      <PublisherSummarySection
        debugWithMultipleModel={false}
        draftUpdatedAt={1_710_000_200_000}
        formatTimeFromNow={() => '2 minutes ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        isWorkflowApp
        multipleModelConfigs={[]}
        onEditVersion={onEditVersion}
        publishDisabled={false}
        published={false}
        publishedAt={1_710_000_100_000}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
        versionInfo={createVersionInfo({
          marked_name: 'Sprint-42',
          marked_comment: 'Fixed data synchronization and page loading.',
        })}
      />,
    )

    expect(screen.getByText('Sprint-42')).toBeInTheDocument()
    expect(screen.getByText('Fixed data synchronization and page loading.')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: /versionHistory\.editVersionInfo\b/,
      }),
    )
    expect(onEditVersion).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /common\.publishUpdate\b/ })).toBeEnabled()
    expect(screen.getByText(/common\.autoSaved\b/)).toBeInTheDocument()
    expect(screen.getAllByText(/2 minutes ago/)).not.toHaveLength(0)
  })

  it('should keep non-workflow apps free of workflow version details and saved time', () => {
    render(
      <PublisherSummarySection
        debugWithMultipleModel={false}
        draftUpdatedAt={1_710_000_200_000}
        formatTimeFromNow={() => '2 minutes ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp
        isWorkflowApp={false}
        multipleModelConfigs={[]}
        publishDisabled={false}
        published={false}
        publishedAt={1_710_000_100_000}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    expect(screen.getAllByText(/common\.latestPublished\b/)).toHaveLength(1)
    expect(screen.queryByText('#5')).not.toBeInTheDocument()
    expect(screen.queryByText(/versionHistory\.nameIt\b/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /common\.publishUpdate\b/ })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(/common\.currentDraft\b/)
  })

  it('should keep multiple-model publishing available without publish config changes', () => {
    const handlePublish = vi.fn()

    render(
      <PublisherSummarySection
        debugWithMultipleModel
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '1 minute ago'}
        handlePublish={handlePublish}
        handleRestore={vi.fn()}
        isChatApp={false}
        multipleModelConfigs={[{ id: '1' } as any]}
        publishDisabled={false}
        published={false}
        publishedAt={Date.now()}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    fireEvent.click(screen.getByText('publish-multiple-model'))

    expect(handlePublish).toHaveBeenCalledWith({ model: 'gpt-4o' })
  })

  it('should disable multiple-model publishing when publishing is unavailable', () => {
    render(
      <PublisherSummarySection
        debugWithMultipleModel
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '1 minute ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        multipleModelConfigs={[{ id: '1' } as any]}
        publishDisabled
        published={false}
        publishedAt={Date.now()}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    expect(screen.getByRole('button', { name: 'publish-multiple-model' })).toBeDisabled()
  })

  it('should render the upgrade hint when the start node limit is exceeded', () => {
    render(
      <PublisherSummarySection
        debugWithMultipleModel={false}
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '1 minute ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        multipleModelConfigs={[]}
        publishDisabled={false}
        published={false}
        publishedAt={undefined}
        startNodeLimitExceeded
        upgradeHighlightStyle={{}}
      />,
    )

    expect(screen.getByText(/(?:^|\.)publishLimit\.startNodeDesc(?=$|:)/)).toBeInTheDocument()
  })

  it('should render the published workflow actions with Workflow as Tool after Marketplace', async () => {
    const user = userEvent.setup()
    const handleOpenRunConfig = vi.fn()
    const onConfigureWorkflowTool = vi.fn()
    const onPublishToMarketplace = vi.fn()

    render(
      <PublisherActionsSection
        appDetail={{
          id: 'workflow-app',
          mode: AppModeEnum.WORKFLOW,
          icon: '⚙️',
          icon_type: 'emoji',
          icon_background: '#fff',
          name: 'Workflow App',
          description: 'Workflow description',
        }}
        appURL="https://example.com/app"
        disabledFunctionButton={false}
        disabledFunctionTooltip="disabled"
        handleOpenRunConfig={handleOpenRunConfig}
        hasHumanInputNode={false}
        hasTriggerNode={false}
        publishedAt={Date.now()}
        showDeployAction
        showMarketplaceAction
        showRunConfig
        workflowToolAvailable
        workflowToolIsLoading={false}
        onPublishToMarketplace={onPublishToMarketplace}
        onConfigureWorkflowTool={onConfigureWorkflowTool}
      />,
    )

    expect(screen.getByRole('link', { name: /common\.openWebApp\b/ })).toHaveAttribute(
      'href',
      'https://example.com/app',
    )
    fireEvent.click(screen.getByRole('button', { name: /(?:^|\.)operation\.config(?=$|:)/ }))
    expect(handleOpenRunConfig).toHaveBeenCalledWith('https://example.com/app')
    expect(screen.getByRole('link', { name: /appMenus\.accessPoint\b/ })).toHaveAttribute(
      'href',
      '/app/workflow-app/access-point',
    )
    expect(screen.getByRole('link', { name: /appMenus\.deploy\b/ })).toHaveAttribute(
      'href',
      '/app/workflow-app/deploy',
    )

    const marketplaceAction = screen.getByRole('button', {
      name: /common\.publishToMarketplace\b/,
    })
    const workflowToolAction = screen.getByRole('button', {
      name: /common\.workflowAsTool\b/,
    })
    expect(
      marketplaceAction.compareDocumentPosition(workflowToolAction) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByRole('status', { name: /common\.configureRequired\b/ })).toBeInTheDocument()

    await user.click(marketplaceAction)
    expect(onPublishToMarketplace).toHaveBeenCalledTimes(1)

    await user.click(workflowToolAction)
    expect(onConfigureWorkflowTool).toHaveBeenCalledTimes(1)
  })

  it('should expose Configure and Manage in Tools actions for a ready workflow tool', async () => {
    const user = userEvent.setup()
    const onConfigureWorkflowTool = vi.fn()

    render(
      <PublisherActionsSection
        appDetail={{
          id: 'workflow-app',
          mode: AppModeEnum.WORKFLOW,
          name: 'Workflow App',
        }}
        appURL="https://example.com/app"
        disabledFunctionButton={false}
        hasHumanInputNode={false}
        hasTriggerNode={false}
        publishedAt={Date.now()}
        showDeployAction
        toolPublished
        workflowToolAvailable
        workflowToolIsLoading={false}
        workflowToolOutdated={false}
        onConfigureWorkflowTool={onConfigureWorkflowTool}
      />,
    )

    expect(
      screen.getByRole('status', { name: /common\.workflowAsToolReady\b/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common\.manageInTools\b/ })).toHaveAttribute(
      'href',
      '/integrations/tools/workflow',
    )

    await user.click(screen.getByRole('button', { name: /common\.configure\b/ }))
    expect(onConfigureWorkflowTool).toHaveBeenCalledTimes(1)
  })

  it('should show the disabled reason below setup and configured workflow tool actions', () => {
    const commonProps = {
      appDetail: {
        id: 'workflow-app',
        mode: AppModeEnum.WORKFLOW,
      },
      appURL: 'https://example.com/app',
      disabledFunctionButton: false,
      hasHumanInputNode: false,
      hasTriggerNode: false,
      onConfigureWorkflowTool: vi.fn(),
      publishedAt: Date.now(),
      workflowToolAvailable: false,
      workflowToolIsLoading: false,
      workflowToolMessage: 'Workflow tool unavailable',
    }
    const { rerender } = render(<PublisherActionsSection {...commonProps} toolPublished={false} />)

    const setupAction = screen.getByRole('button', { name: /common\.workflowAsTool\b/ })
    const setupReason = screen.getByText('Workflow tool unavailable')
    expect(setupAction).toBeDisabled()
    expect(setupReason).toBeVisible()
    expect(
      setupAction.compareDocumentPosition(setupReason) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    rerender(<PublisherActionsSection {...commonProps} toolPublished />)

    const configureAction = screen.getByRole('button', { name: /common\.configure\b/ })
    const manageAction = screen.getByRole('button', { name: /common\.manageInTools\b/ })
    const configuredReason = screen.getByText('Workflow tool unavailable')
    expect(configureAction).toBeDisabled()
    expect(manageAction).toBeDisabled()
    expect(configuredReason).toBeVisible()
    expect(
      manageAction.compareDocumentPosition(configuredReason) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('should surface update-needed and loading states for a configured workflow tool', async () => {
    const user = userEvent.setup()
    const onConfigureWorkflowTool = vi.fn()
    const commonProps = {
      appDetail: {
        id: 'workflow-app',
        mode: AppModeEnum.WORKFLOW,
      },
      appURL: 'https://example.com/app',
      disabledFunctionButton: false,
      hasHumanInputNode: false,
      hasTriggerNode: false,
      onConfigureWorkflowTool,
      publishedAt: Date.now(),
      toolPublished: true,
      workflowToolAvailable: true,
    }
    const { rerender } = render(
      <PublisherActionsSection
        {...commonProps}
        workflowToolIsLoading={false}
        workflowToolOutdated
      />,
    )

    expect(
      screen.getByRole('status', { name: /common\.workflowAsToolUpdateNeeded\b/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/common\.workflowAsToolTip\b/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /common\.workflowAsToolReconfigure\b/ }))
    expect(onConfigureWorkflowTool).toHaveBeenCalledTimes(1)

    rerender(
      <PublisherActionsSection
        {...commonProps}
        workflowToolIsLoading
        workflowToolOutdated={false}
      />,
    )

    expect(screen.getByRole('button', { name: /common\.workflowAsTool\b/ })).toBeDisabled()
    expect(screen.getByRole('status', { name: /loading\b/ })).toBeInTheDocument()
    expect(screen.queryByText(/common\.workflowAsToolTip\b/)).not.toBeInTheDocument()
  })

  it('should keep Access Point and Deploy available for trigger workflows', () => {
    render(
      <PublisherActionsSection
        appDetail={{
          id: 'trigger-app',
          mode: AppModeEnum.WORKFLOW,
        }}
        appURL="https://example.com/app"
        disabledFunctionButton={false}
        hasHumanInputNode={false}
        hasTriggerNode
        publishedAt={Date.now()}
        showDeployAction
        workflowToolAvailable
        workflowToolIsLoading={false}
        onConfigureWorkflowTool={vi.fn()}
      />,
    )

    expect(screen.queryByText(/(?:^|\.)common\.openWebApp(?=$|:)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/(?:^|\.)common\.workflowAsTool(?=$|:)/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /appMenus\.accessPoint\b/ })).toHaveAttribute(
      'href',
      '/app/trigger-app/access-point',
    )
    expect(screen.getByRole('link', { name: /appMenus\.deploy\b/ })).toHaveAttribute(
      'href',
      '/app/trigger-app/deploy',
    )
  })

  it('should expose unavailable quick links as disabled buttons before the first publish', () => {
    render(
      <PublisherActionsSection
        appDetail={{ id: 'workflow-app', mode: AppModeEnum.WORKFLOW }}
        appURL="https://example.com/app"
        disabledFunctionButton
        hasHumanInputNode={false}
        hasTriggerNode={false}
        publishedAt={undefined}
        showDeployAction
        workflowToolAvailable
        workflowToolIsLoading={false}
        onConfigureWorkflowTool={vi.fn()}
      />,
    )

    expect(screen.getByText(/(?:^|\.)common\.openWebApp(?=$|:)/).closest('button')).toBeDisabled()
    expect(
      screen.getByText(/(?:^|\.)appMenus\.accessPoint(?=$|:)/).closest('button'),
    ).toBeDisabled()
    expect(screen.getByText(/(?:^|\.)appMenus\.deploy(?=$|:)/).closest('button')).toBeDisabled()
    expect(
      screen.getByText(/(?:^|\.)common\.workflowAsTool(?=$|:)/).closest('button'),
    ).toBeDisabled()
  })

  it('should show the disabled reason when hovering an unavailable action', async () => {
    const user = userEvent.setup()

    render(
      <PublisherActionsSection
        appDetail={{ id: 'workflow-app', mode: AppModeEnum.WORKFLOW }}
        appURL="https://example.com/app"
        disabledFunctionButton
        disabledFunctionTooltip="Open web app unavailable"
        hasHumanInputNode={false}
        hasTriggerNode={false}
        publishedAt={undefined}
        workflowToolAvailable
        workflowToolIsLoading={false}
        onConfigureWorkflowTool={vi.fn()}
      />,
    )

    await user.hover(screen.getByRole('button', { name: /common\.openWebApp\b/ }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Open web app unavailable')
  })

  it('should keep an unavailable action with a tooltip keyboard focusable', async () => {
    const user = userEvent.setup()

    render(
      <PublisherActionsSection
        appDetail={{ id: 'workflow-app', mode: AppModeEnum.WORKFLOW }}
        appURL="https://example.com/app"
        disabledFunctionButton
        disabledFunctionTooltip="Open web app unavailable"
        hasHumanInputNode={false}
        hasTriggerNode={false}
        publishedAt={undefined}
        workflowToolAvailable
        workflowToolIsLoading={false}
        onConfigureWorkflowTool={vi.fn()}
      />,
    )

    await user.tab()

    const action = screen.getByRole('button', { name: /common\.openWebApp\b/ })
    expect(action).toHaveFocus()
    expect(action).toHaveAttribute('aria-disabled', 'true')
    expect(action).toHaveAccessibleDescription('Open web app unavailable')
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Open web app unavailable')
  })
})
