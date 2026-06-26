import type { Environment } from '@dify/contracts/enterprise/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateApiKeyButton } from '../create-api-key-button'
import { CreateApiKeyDialog } from '../create-api-key-dialog'

const mockMutate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    isPending: false,
    mutate: mockMutate,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      accessService: {
        createApiKey: {
          mutationOptions: () => ({ mutationKey: ['createApiKey'] }),
        },
      },
    },
  },
}))

function createEnvironment(): Environment {
  return {
    id: 'environment-1',
    displayName: 'Production',
  } as Environment
}

function renderCreateApiKeyDialog() {
  return render(
    <CreateApiKeyDialog
      appInstanceId="app-instance-1"
      environments={[createEnvironment()]}
      open
      sessionKey={0}
      onCreatedToken={vi.fn()}
      onOpenChange={vi.fn()}
    />,
  )
}

// API token creation keeps validation and mutation payload shaping inside the dialog content.
describe('CreateApiKeyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show the required name error when submitting an empty name', () => {
    renderCreateApiKeyDialog()

    fireEvent.change(screen.getByLabelText('deployments.access.api.nameLabel'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'deployments.access.api.createKey' }))

    expect(screen.getByText('deployments.access.api.nameRequired')).toBeInTheDocument()
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('should clear the required name error when typing a valid name', () => {
    renderCreateApiKeyDialog()

    const nameInput = screen.getByLabelText('deployments.access.api.nameLabel')

    fireEvent.change(nameInput, {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'deployments.access.api.createKey' }))
    expect(screen.getByText('deployments.access.api.nameRequired')).toBeInTheDocument()

    fireEvent.change(nameInput, {
      target: { value: 'Production key' },
    })

    expect(screen.queryByText('deployments.access.api.nameRequired')).not.toBeInTheDocument()
  })

  it('should create an api key with the entered name and default environment', () => {
    renderCreateApiKeyDialog()

    fireEvent.change(screen.getByLabelText('deployments.access.api.nameLabel'), {
      target: { value: ' Production key ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'deployments.access.api.createKey' }))

    expect(mockMutate).toHaveBeenCalledWith(
      {
        params: {
          appInstanceId: 'app-instance-1',
          environmentId: 'environment-1',
        },
        body: {
          appInstanceId: 'app-instance-1',
          environmentId: 'environment-1',
          displayName: 'Production key',
        },
      },
      expect.any(Object),
    )
  })
})

// The trigger is a placement-neutral button; the owning section controls dialog state.
describe('CreateApiKeyButton', () => {
  it('should call the supplied action when enabled', () => {
    const handleClick = vi.fn()

    render(<CreateApiKeyButton onClick={handleClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'deployments.access.api.newKey' }))

    expect(handleClick).toHaveBeenCalledOnce()
  })

  it('should disable the trigger when creation is not available', () => {
    render(<CreateApiKeyButton disabled onClick={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'deployments.access.api.newKey' })).toBeDisabled()
  })
})
