import type { ComponentProps } from 'react'
import type { VersionHistory } from '@/types/workflow'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useRef } from 'react'
import { expectLoadingButton } from '@/test/button'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { AppModeEnum } from '@/types/app'
import { PublisherActionsSection } from '../built-in-publisher/actions-section'
import { PublisherSummarySection } from '../built-in-publisher/summary-section'
import { usePublishController } from '../publisher-content/use-publish-controller'

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

function PublisherPopup({
  defaultOpen = false,
  ...props
}: Partial<Omit<ComponentProps<typeof PublisherSummarySection>, 'keyboardTarget'>> & {
  defaultOpen?: boolean
}) {
  const popupRef = useRef<HTMLDivElement>(null)
  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger>Open publisher</PopoverTrigger>
      <PopoverContent ref={popupRef}>
        <PublisherSummarySection
          keyboardTarget={popupRef}
          formatTimeFromNow={() => 'just now'}
          handlePublish={vi.fn().mockResolvedValue(undefined)}
          handleRestore={vi.fn().mockResolvedValue(undefined)}
          isChatApp={false}
          isPublishing={false}
          published={false}
          upgradeHighlightStyle={{}}
          {...props}
        />
      </PopoverContent>
    </Popover>
  )
}

function PublishingPopup({ onPublish }: { onPublish: () => Promise<void> }) {
  const publish = usePublishController({
    appMode: AppModeEnum.CHAT,
    supportsMultiEnvironment: false,
    onClose: () => {},
    onPublish,
  })
  return (
    <PublisherPopup
      handlePublish={publish.handlePublish}
      published={publish.published}
      isPublishing={publish.isPublishing}
    />
  )
}

function publishFrom(target: HTMLElement, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'P',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  })
  fireEvent(target, event)
  fireEvent.keyUp(target, { key: 'P', ctrlKey: true, shiftKey: true })
  return event
}

describe('app-publisher sections', () => {
  it('publishes only from its open built-in popup and unregisters when the popup closes', async () => {
    const user = userEvent.setup()
    const handlePublish = vi.fn().mockResolvedValue(undefined)
    render(<PublisherPopup handlePublish={handlePublish} />)
    expect(publishFrom(document.body).defaultPrevented).toBe(false)
    expect(handlePublish).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Open publisher' }))
    const button = screen.getByRole('button', { name: /common\.publish\b/ })
    expect(publishFrom(document.body).defaultPrevented).toBe(false)
    await act(async () => {
      expect(publishFrom(button).defaultPrevented).toBe(true)
    })
    expect(handlePublish).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Open publisher' }))
    expect(publishFrom(document.body).defaultPrevented).toBe(false)
    expect(handlePublish).toHaveBeenCalledTimes(1)
  })

  it.each([{ publishDisabled: true }, { published: true }])(
    'shares the disabled state between the publish button and shortcut: %o',
    async (props) => {
      const user = userEvent.setup()
      const handlePublish = vi.fn().mockResolvedValue(undefined)
      render(<PublisherPopup {...props} handlePublish={handlePublish} />)
      await user.click(screen.getByRole('button', { name: 'Open publisher' }))
      const button = screen.getByRole('button', { name: /common\.publish/ })
      expect(button).toBeDisabled()
      expect(publishFrom(button).defaultPrevented).toBe(false)
      await user.click(button)
      expect(handlePublish).not.toHaveBeenCalled()
    },
  )

  it('consumes held publish keys and allows publishing again after release', async () => {
    const user = userEvent.setup()
    const handlePublish = vi.fn().mockResolvedValue(undefined)
    render(<PublisherPopup handlePublish={handlePublish} />)
    await user.click(screen.getByRole('button', { name: 'Open publisher' }))
    const button = screen.getByRole('button', { name: /common\.publish\b/ })
    const keyOptions = {
      key: 'P',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }
    const keyDown = new KeyboardEvent('keydown', keyOptions)
    const repeatedKeyDown = new KeyboardEvent('keydown', { ...keyOptions, repeat: true })

    fireEvent(button, keyDown)
    fireEvent(button, repeatedKeyDown)
    expect(keyDown.defaultPrevented).toBe(true)
    expect(repeatedKeyDown.defaultPrevented).toBe(true)
    expect(handlePublish).toHaveBeenCalledTimes(1)

    fireEvent.keyUp(button, keyOptions)
    publishFrom(button)
    expect(handlePublish).toHaveBeenCalledTimes(2)
  })

  it('prevents a second publish while the shared publish action is pending', async () => {
    const user = userEvent.setup()
    let resolvePublish: () => void = () => {}
    const handlePublish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePublish = resolve
        }),
    )
    render(<PublishingPopup onPublish={handlePublish} />)
    await user.click(screen.getByRole('button', { name: 'Open publisher' }))
    const button = screen.getByRole('button', { name: /common\.publish\b/ })
    publishFrom(button)
    expectLoadingButton(button)
    publishFrom(button)
    await user.click(button)
    expect(handlePublish).toHaveBeenCalledTimes(1)
    await act(async () => resolvePublish())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /common\.published\b/ })).toBeDisabled(),
    )
  })

  it('keeps a pending publication locked when its popup closes and reopens', async () => {
    const user = userEvent.setup()
    let resolvePublish: () => void = () => {}
    const onPublish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePublish = resolve
        }),
    )
    render(<PublishingPopup onPublish={onPublish} />)
    const trigger = screen.getByRole('button', { name: 'Open publisher' })
    await user.click(trigger)
    publishFrom(screen.getByRole('button', { name: /common\.publish\b/ }))
    expect(onPublish).toHaveBeenCalledOnce()
    await user.click(trigger)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /common\.publish\b/ })).not.toBeInTheDocument(),
    )
    await user.click(trigger)
    const reopenedButton = screen.getByRole('button', { name: /common\.publish\b/ })
    expectLoadingButton(reopenedButton)
    publishFrom(reopenedButton)
    await user.click(reopenedButton)
    expect(onPublish).toHaveBeenCalledOnce()
    await act(async () => resolvePublish())
    expect(screen.getByRole('button', { name: /common\.published\b/ })).toBeDisabled()
  })

  it('allows a retry after the publication fails', async () => {
    const user = userEvent.setup()
    let rejectPublish: (error: Error) => void = () => {}
    const onPublish = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectPublish = reject
          }),
      )
      .mockResolvedValue(undefined)
    render(<PublishingPopup onPublish={onPublish} />)
    await user.click(screen.getByRole('button', { name: 'Open publisher' }))
    const button = screen.getByRole('button', { name: /common\.publish\b/ })
    await user.click(button)
    expectLoadingButton(button)
    await act(async () => rejectPublish(new Error('Publication failed')))
    expect(button).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(button)
    expect(onPublish).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: /common\.published\b/ })).toBeDisabled()
  })

  it('keeps multiple-model publication behind the model selection action', async () => {
    const user = userEvent.setup()
    const handlePublish = vi.fn().mockResolvedValue(undefined)
    render(<PublisherPopup debugWithMultipleModel handlePublish={handlePublish} />)
    await user.click(screen.getByRole('button', { name: 'Open publisher' }))
    const modelButton = screen.getByRole('button', { name: 'publish-multiple-model' })
    expect(publishFrom(modelButton).defaultPrevented).toBe(false)
    expect(handlePublish).not.toHaveBeenCalled()
    await user.click(modelButton)
    expect(handlePublish).toHaveBeenCalledWith({ model: 'gpt-4o' })
  })

  it('should render restore controls for published chat apps', () => {
    const handleRestore = vi.fn()

    render(
      <PublisherPopup
        defaultOpen
        debugWithMultipleModel={false}
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '3 minutes ago'}
        handlePublish={vi.fn()}
        handleRestore={handleRestore}
        isChatApp
        isPublishing={false}
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
    expect(screen.getByRole('status').textContent).toMatch(/common\.currentDraft\b/)
  })

  it('should disable publish and restore after publishing in the current open session', async () => {
    const user = userEvent.setup()
    const handleRestore = vi.fn()

    render(
      <PublisherPopup
        defaultOpen
        debugWithMultipleModel={false}
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '3 minutes ago'}
        handlePublish={vi.fn()}
        handleRestore={handleRestore}
        isChatApp
        isPublishing={false}
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
    expect(screen.getByRole('status').textContent).toMatch(/common\.upToDate\b/)
    await user.click(restoreButton)
    expect(handleRestore).not.toHaveBeenCalled()
  })

  it('should render the initial publish action when the draft has not been published yet', () => {
    render(
      <PublisherPopup
        defaultOpen
        debugWithMultipleModel={false}
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '1 minute ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        isPublishing={false}
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
    expect(screen.getByRole('status').textContent).toMatch(/common\.currentDraft\b/)
  })

  it('should expose naming and keep publishing available for an unnamed published workflow', () => {
    const onEditVersion = vi.fn()

    render(
      <PublisherPopup
        defaultOpen
        debugWithMultipleModel={false}
        draftUpdatedAt={1_710_000_000_000}
        formatTimeFromNow={() => '17 days ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        isPublishing={false}
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
      <PublisherPopup
        defaultOpen
        debugWithMultipleModel={false}
        draftUpdatedAt={1_710_000_200_000}
        formatTimeFromNow={() => '2 minutes ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        isPublishing={false}
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
      <PublisherPopup
        defaultOpen
        debugWithMultipleModel={false}
        draftUpdatedAt={1_710_000_200_000}
        formatTimeFromNow={() => '2 minutes ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp
        isPublishing={false}
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
    expect(screen.getByRole('status').textContent).toMatch(/common\.currentDraft\b/)
  })

  it('should keep multiple-model publishing available without publish config changes', () => {
    const handlePublish = vi.fn()

    render(
      <PublisherPopup
        defaultOpen
        debugWithMultipleModel
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '1 minute ago'}
        handlePublish={handlePublish}
        handleRestore={vi.fn()}
        isChatApp={false}
        isPublishing={false}
        multipleModelConfigs={[]}
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
      <PublisherPopup
        defaultOpen
        debugWithMultipleModel
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '1 minute ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        isPublishing={false}
        multipleModelConfigs={[]}
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
      <PublisherPopup
        defaultOpen
        debugWithMultipleModel={false}
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '1 minute ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        isPublishing={false}
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
        canViewAccessPoint
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
        canViewAccessPoint
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
      canViewAccessPoint: true,
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
      canViewAccessPoint: true,
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
        canViewAccessPoint
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

  it('should hide the Access Point publisher entry without view permission', () => {
    render(
      <PublisherActionsSection
        appDetail={{ id: 'workflow-app', mode: AppModeEnum.WORKFLOW }}
        appURL="https://example.com/app"
        canViewAccessPoint={false}
        disabledFunctionButton={false}
        hasHumanInputNode={false}
        hasTriggerNode={false}
        publishedAt={Date.now()}
        showDeployAction
        workflowToolAvailable
        workflowToolIsLoading={false}
        onConfigureWorkflowTool={vi.fn()}
      />,
    )

    expect(screen.queryByRole('link', { name: /appMenus\.accessPoint\b/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /appMenus\.deploy\b/ })).toHaveAttribute(
      'href',
      '/app/workflow-app/deploy',
    )
  })

  it('should expose unavailable quick links as disabled buttons before the first publish', () => {
    render(
      <PublisherActionsSection
        appDetail={{ id: 'workflow-app', mode: AppModeEnum.WORKFLOW }}
        appURL="https://example.com/app"
        canViewAccessPoint
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
        canViewAccessPoint
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

    expect(
      await screen.findByText('Open web app unavailable', { selector: '[data-open]' }),
    ).toBeVisible()
  })

  it('should keep an unavailable action with a tooltip keyboard focusable', async () => {
    const user = userEvent.setup()

    render(
      <PublisherActionsSection
        appDetail={{ id: 'workflow-app', mode: AppModeEnum.WORKFLOW }}
        appURL="https://example.com/app"
        canViewAccessPoint
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
    expect(
      await screen.findByText('Open web app unavailable', { selector: '[data-open]' }),
    ).toBeVisible()
  })
})

function render(ui: React.ReactElement) {
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper()
  return renderWithConsoleState(ui, {
    wrapper: ({ children }) => (
      <NuqsTestingAdapter>
        <QueryWrapper>{children}</QueryWrapper>
      </NuqsTestingAdapter>
    ),
  })
}
