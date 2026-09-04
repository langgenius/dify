import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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

function PublisherPanelHarness() {
  const [open, setOpen] = useState(true)

  return (
    <>
      <button type="button">Outside control</button>
      <PublisherPanel
        builtInPublisher={{
          actions: {
            appDetail: null,
            appURL: '',
            canViewAccessPoint: false,
            disabledFunctionButton: false,
            workflowToolIsLoading: false,
            onConfigureWorkflowTool: vi.fn(),
          },
          summary: {
            formatTimeFromNow: () => '',
            handlePublish: vi.fn(),
            handleRestore: vi.fn(),
            isChatApp: false,
            published: false,
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
        showBuiltInPublisher={false}
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
