import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AppModeEnum } from '@/types/app'
import { PublisherPanel } from '../publisher-content/publisher-panel'

vi.mock('../environment-deployment-flow', () => ({
  PublisherEnvironmentFlow: ({
    onConfigurationOpenChange,
  }: {
    onConfigurationOpenChange?: (open: boolean) => void
  }) => (
    <div>
      Environment publisher
      <button type="button" onClick={() => onConfigurationOpenChange?.(true)}>
        Configure deployment
      </button>
    </div>
  ),
}))

function PublisherPanelHarness({
  initialOpen = true,
  onPublish = vi.fn(),
  showBuiltInPublisher = false,
}: {
  initialOpen?: boolean
  onPublish?: () => Promise<void>
  showBuiltInPublisher?: boolean
}) {
  const [open, setOpen] = useState(initialOpen)

  return (
    <>
      <button type="button">Outside control</button>
      <PublisherPanel
        builtInPublisher={{
          actions: {
            appDetail: { id: 'app-1', mode: AppModeEnum.CHAT },
            appURL: 'https://example.com/app',
            canViewAccessPoint: false,
            disabledFunctionButton: false,
            publishedAt: 1_710_000_000_000,
            workflowToolIsLoading: false,
            onConfigureWorkflowTool: vi.fn(),
          },
          summary: {
            formatTimeFromNow: () => '',
            handlePublish: onPublish,
            handleRestore: vi.fn(),
            isChatApp: false,
            isPublishing: false,
            published: false,
            publishedAt: 1_710_000_000_000,
            upgradeHighlightStyle: {},
          },
        }}
        environmentPublisher={{
          appId: 'app-1',
          canViewAccessPoint: false,
          environmentId: 'staging',
          environmentName: 'Staging',
          environmentTabs: null,
          isEnvironmentInUse: true,
          isDeploymentError: false,
          isDeploymentLoading: false,
          onGoToPublish: vi.fn(),
        }}
        environmentPublisherKey="staging"
        open={open}
        showBuiltInPublisher={showBuiltInPublisher}
        workflowLaunch={{
          hiddenVariables: [],
          open: false,
          targetUrl: '',
          onOpenChange: vi.fn(),
        }}
        onOpenChange={setOpen}
      />
    </>
  )
}

describe('PublisherPanel', () => {
  it('publishes from the actions section on first open and reopen, but not while closed', async () => {
    const user = userEvent.setup()
    const onPublish = vi.fn().mockResolvedValue(undefined)
    const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    const shortcut = `{${modifier}>}{Shift>}P{/Shift}{/${modifier}}`
    render(<PublisherPanelHarness initialOpen={false} onPublish={onPublish} showBuiltInPublisher />)
    const trigger = screen.getByRole('button', { name: /common\.publish\b/ })

    for (let opened = 1; opened <= 2; opened++) {
      await user.click(trigger)
      const openWebApp = screen.getByRole('link', { name: /common\.openWebApp\b/ })
      act(() => openWebApp.focus())
      expect(openWebApp).toHaveFocus()
      expect(screen.getByRole('button', { name: /common\.publishUpdate\b/ })).toBeEnabled()
      await user.keyboard(shortcut)
      expect(onPublish).toHaveBeenCalledTimes(opened)

      await user.click(trigger)
      await waitFor(() =>
        expect(
          screen.queryByRole('link', { name: /common\.openWebApp\b/ }),
        ).not.toBeInTheDocument(),
      )
      expect(trigger).toHaveFocus()
      await user.keyboard(shortcut)
      expect(onPublish).toHaveBeenCalledTimes(opened)
    }
  })

  it('keeps the publisher open after an outside press when dismissal is prevented', async () => {
    const user = userEvent.setup()
    render(<PublisherPanelHarness />)

    await user.click(screen.getByRole('button', { name: 'Configure deployment' }))

    await user.click(screen.getByRole('button', { name: 'Outside control' }))

    expect(screen.getByText('Environment publisher')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /common\.publish/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('keeps the default outside-press dismissal outside deployment configuration', async () => {
    const user = userEvent.setup()
    render(<PublisherPanelHarness />)

    await user.click(screen.getByRole('button', { name: 'Outside control' }))

    expect(screen.queryByText('Environment publisher')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /common\.publish/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('still closes from the trigger and Escape when outside dismissal is prevented', async () => {
    const user = userEvent.setup()
    render(<PublisherPanelHarness />)
    const publishButton = screen.getByRole('button', { name: /common\.publish/ })

    await user.click(screen.getByRole('button', { name: 'Configure deployment' }))
    await user.click(publishButton)
    expect(screen.queryByText('Environment publisher')).not.toBeInTheDocument()

    await user.click(publishButton)
    expect(screen.getByText('Environment publisher')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Configure deployment' }))

    await user.keyboard('{Escape}')

    expect(screen.queryByText('Environment publisher')).not.toBeInTheDocument()
  })
})
