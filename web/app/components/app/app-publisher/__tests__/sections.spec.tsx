/* eslint-disable ts/no-explicit-any */
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { AccessModeDisplay, PublisherAccessSection, PublisherActionsSection, PublisherSummarySection } from '../sections'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../publish-with-multiple-model', () => ({
  default: ({ onSelect }: { onSelect: (item: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => onSelect({ model: 'gpt-4o' })}>publish-multiple-model</button>
  ),
}))

vi.mock('../suggested-action', () => ({
  default: ({
    children,
    onClick,
    link,
    disabled,
    actionButton,
  }: {
    children: ReactNode
    onClick?: () => void
    link?: string
    disabled?: boolean
    actionButton?: { ariaLabel: string, onClick: () => void }
  }) => (
    <div>
      <button type="button" data-link={link} disabled={disabled} onClick={onClick}>{children}</button>
      {actionButton && (
        <button
          type="button"
          aria-label={actionButton.ariaLabel}
          disabled={disabled}
          onClick={actionButton.onClick}
        >
          {actionButton.ariaLabel}
        </button>
      )}
    </div>
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
        publishShortcut={['ctrl', '⇧', 'P']}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    fireEvent.click(screen.getByText('common.restore'))
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

    expect(screen.getByText('publishApp.notSet')).toBeInTheDocument()
    expect(screen.getByText('publishApp.notSetDesc')).toBeInTheDocument()
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
        publishShortcut={['ctrl', '⇧', 'P']}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    expect(screen.getByText('common.publishUpdate')).toBeInTheDocument()
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
        publishShortcut={['ctrl', '⇧', 'P']}
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
        publishShortcut={['ctrl', '⇧', 'P']}
        startNodeLimitExceeded
        upgradeHighlightStyle={{}}
      />,
    )

    expect(screen.getByText('publishLimit.startNodeDesc')).toBeInTheDocument()
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

    expect(screen.getByText('accessControlDialog.accessItems.anyone')).toBeInTheDocument()
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

    expect(screen.queryByText('publishApp.title')).not.toBeInTheDocument()
    expect(screen.queryByText('accessControlDialog.accessItems.anyone')).not.toBeInTheDocument()
  })

  it('should render workflow actions, batch run links, and workflow tool configuration', () => {
    const handleOpenInExplore = vi.fn()
    const handleEmbed = vi.fn()
    const handleOpenRunConfig = vi.fn()

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
        handleEmbed={handleEmbed}
        handleOpenInExplore={handleOpenInExplore}
        handleOpenRunConfig={handleOpenRunConfig}
        handlePublish={vi.fn()}
        hasHumanInputNode={false}
        hasTriggerNode={false}
        missingStartNode={false}
        published={false}
        publishedAt={Date.now()}
        showBatchRunConfig
        showRunConfig
        toolPublished
        workflowToolAvailable={false}
        workflowToolIsLoading={false}
        workflowToolOutdated={false}
        workflowToolIsCurrentWorkspaceManager
        workflowToolMessage="workflow-disabled"
        onConfigureWorkflowTool={vi.fn()}
      />,
    )

    expect(screen.getByText('common.batchRunApp')).toHaveAttribute('data-link', 'https://example.com/app?mode=batch')
    fireEvent.click(screen.getAllByRole('button', { name: 'operation.config' })[0]!)
    expect(handleOpenRunConfig).toHaveBeenCalledWith('https://example.com/app')
    fireEvent.click(screen.getAllByRole('button', { name: 'operation.config' })[1]!)
    expect(handleOpenRunConfig).toHaveBeenCalledWith('https://example.com/app?mode=batch')
    fireEvent.click(screen.getByText('common.openInExplore'))
    expect(handleOpenInExplore).toHaveBeenCalled()
    expect(screen.getByText('workflow-tool-configure')).toBeInTheDocument()
    expect(screen.getByText('workflow-disabled')).toBeInTheDocument()

    rerender(
      <PublisherActionsSection
        appDetail={{
          id: 'chat-app',
          mode: AppModeEnum.CHAT,
          name: 'Chat App',
        }}
        appURL="https://example.com/app?foo=bar"
        disabledFunctionButton
        disabledFunctionTooltip="disabled"
        handleEmbed={handleEmbed}
        handleOpenInExplore={handleOpenInExplore}
        handleOpenRunConfig={handleOpenRunConfig}
        handlePublish={vi.fn()}
        hasHumanInputNode={false}
        hasTriggerNode={false}
        missingStartNode
        published={false}
        publishedAt={Date.now()}
        toolPublished={false}
        workflowToolAvailable
        workflowToolIsLoading={false}
        workflowToolOutdated={false}
        workflowToolIsCurrentWorkspaceManager
        onConfigureWorkflowTool={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('common.embedIntoSite'))
    expect(handleEmbed).toHaveBeenCalled()
    expect(screen.getByText('common.accessAPIReference')).toBeDisabled()

    rerender(
      <PublisherActionsSection
        appDetail={{ id: 'trigger-app', mode: AppModeEnum.WORKFLOW }}
        appURL="https://example.com/app"
        disabledFunctionButton={false}
        handleEmbed={handleEmbed}
        handleOpenInExplore={handleOpenInExplore}
        handleOpenRunConfig={handleOpenRunConfig}
        handlePublish={vi.fn()}
        hasHumanInputNode={false}
        hasTriggerNode
        missingStartNode={false}
        published={false}
        publishedAt={undefined}
        toolPublished={false}
        workflowToolAvailable
        workflowToolIsLoading={false}
        workflowToolOutdated={false}
        workflowToolIsCurrentWorkspaceManager
        onConfigureWorkflowTool={vi.fn()}
      />,
    )

    expect(screen.queryByText('common.runApp')).not.toBeInTheDocument()
  })
})
