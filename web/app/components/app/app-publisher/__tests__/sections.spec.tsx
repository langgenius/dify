/* oxlint-disable typescript/no-explicit-any */
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessMode } from '@/models/access-control'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import {
  AccessModeDisplay,
  PublisherAccessSection,
  PublisherActionsSection,
  PublisherSummarySection,
} from '../sections'

vi.mock('../publish-with-multiple-model', () => ({
  default: ({ onSelect }: { onSelect: (item: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => onSelect({ model: 'gpt-4o' })}>
      publish-multiple-model
    </button>
  ),
}))

vi.mock('@/app/components/tools/workflow-tool/configure-button', () => ({
  default: (props: Record<string, unknown>) => (
    <div>
      workflow-tool-configure
      <span>{String(props.disabledReason || '')}</span>
    </div>
  ),
}))

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
  })

  it('should expose the access control warning when subjects are missing', () => {
    render(
      <PublisherAccessSection
        enabled
        isAppAccessSet={false}
        isLoading={false}
        accessMode={AccessMode.SPECIFIC_GROUPS_MEMBERS}
        onClick={vi.fn()}
      />,
    )

    expect(screen.getByText(/(?:^|\.)publishApp\.notSet(?=$|:)/)).toBeInTheDocument()
    expect(screen.getByText(/(?:^|\.)publishApp\.notSetDesc(?=$|:)/)).toBeInTheDocument()
  })

  it('should render the publish update action when the draft has not been published yet', () => {
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

    expect(screen.getByText(/(?:^|\.)common\.publishUpdate(?=$|:)/)).toBeInTheDocument()
  })

  it('should render multiple-model publishing', () => {
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
        publishedAt={undefined}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    fireEvent.click(screen.getByText('publish-multiple-model'))

    expect(handlePublish).toHaveBeenCalledWith({ model: 'gpt-4o' })
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

  it('should render loading access state and access mode labels when enabled', () => {
    const { rerender } = render(
      <PublisherAccessSection
        enabled
        isAppAccessSet
        isLoading
        accessMode={AccessMode.PUBLIC}
        onClick={vi.fn()}
      />,
    )

    expect(document.querySelector('.spin-animation')).toBeInTheDocument()

    rerender(
      <PublisherAccessSection
        enabled
        isAppAccessSet
        isLoading={false}
        accessMode={AccessMode.PUBLIC}
        onClick={vi.fn()}
      />,
    )

    expect(
      screen.getByText(/(?:^|\.)accessControlDialog\.accessItems\.anyone(?=$|:)/),
    ).toBeInTheDocument()
    expect(render(<AccessModeDisplay />).container).toBeEmptyDOMElement()
  })

  it('should hide access control content when enabled is false', () => {
    render(
      <PublisherAccessSection
        enabled={false}
        isAppAccessSet
        isLoading={false}
        accessMode={AccessMode.PUBLIC}
        onClick={vi.fn()}
      />,
    )

    expect(screen.queryByText(/(?:^|\.)publishApp\.title(?=$|:)/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/(?:^|\.)accessControlDialog\.accessItems\.anyone(?=$|:)/),
    ).not.toBeInTheDocument()
  })

  it('should render the published workflow quick links and configure workflow tools', () => {
    const handleOpenRunConfig = vi.fn()
    const onConfigureWorkflowTool = vi.fn()

    const { rerender } = render(
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
        showRunConfig
        workflowToolAvailable={false}
        workflowToolIsLoading={false}
        workflowToolMessage="workflow-disabled"
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

    const workflowToolAction = screen.getByRole('button', {
      name: /common\.workflowAsTool\b/,
    })
    expect(workflowToolAction).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status', { name: /common\.configureRequired\b/ })).toBeInTheDocument()

    rerender(
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
      screen.queryByRole('status', { name: /common\.configureRequired\b/ }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /common\.workflowAsTool\b/ }))
    expect(onConfigureWorkflowTool).toHaveBeenCalledTimes(1)
  })

  it('should surface outdated and loading states for a configured workflow tool', () => {
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

    const workflowToolAction = screen.getByRole('button', {
      name: /common\.workflowAsTool\b/,
    })
    expect(workflowToolAction).toHaveAccessibleDescription(
      expect.stringMatching(/common\.workflowAsToolTip\b/),
    )
    expect(screen.getByRole('status', { name: /common\.workflowAsToolTip\b/ })).toBeInTheDocument()

    rerender(
      <PublisherActionsSection
        {...commonProps}
        workflowToolIsLoading
        workflowToolOutdated={false}
      />,
    )

    expect(screen.getByRole('button', { name: /common\.workflowAsTool\b/ })).toBeDisabled()
    expect(screen.getByRole('status', { name: /loading\b/ })).toBeInTheDocument()
  })

  it('should show the outdated reason when hovering a configured workflow tool', async () => {
    const user = userEvent.setup()

    render(
      <PublisherActionsSection
        appDetail={{
          id: 'workflow-app',
          mode: AppModeEnum.WORKFLOW,
        }}
        appURL="https://example.com/app"
        disabledFunctionButton={false}
        hasHumanInputNode={false}
        hasTriggerNode={false}
        publishedAt={Date.now()}
        toolPublished
        workflowToolAvailable
        workflowToolIsLoading={false}
        workflowToolOutdated
        onConfigureWorkflowTool={vi.fn()}
      />,
    )

    await user.hover(screen.getByRole('button', { name: /common\.workflowAsTool\b/ }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(/common\.workflowAsToolTip\b/)
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
