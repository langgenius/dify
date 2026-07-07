import type { Environment } from '@dify/contracts/enterprise/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { deploymentRouteAppInstanceIdAtom } from '../../../../route-state'
import { ApiKeyGenerateMenu } from '../api-key-generate-menu'

const mockMutate = vi.hoisted(() => vi.fn())
const mockUseAtomValue = vi.hoisted(() => vi.fn())

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()
  return {
    ...actual,
    useAtomValue: mockUseAtomValue,
  }
})

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

describe('ApiKeyGenerateMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAtomValue.mockImplementation((atom) => {
      if (atom === deploymentRouteAppInstanceIdAtom)
        return 'app-instance-1'
      return undefined
    })
  })

  it('should show the required name error when submitting an empty name', () => {
    render(
      <ApiKeyGenerateMenu
        environments={[createEnvironment()]}
        onCreatedToken={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'deployments.access.api.newKey' }))
    fireEvent.change(screen.getByLabelText('deployments.access.api.nameLabel'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'deployments.access.api.createKey' }))

    expect(screen.getByText('deployments.access.api.nameRequired')).toBeInTheDocument()
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('should clear the required name error when typing a valid name', () => {
    render(
      <ApiKeyGenerateMenu
        environments={[createEnvironment()]}
        onCreatedToken={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'deployments.access.api.newKey' }))
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

  it('should disable the trigger when route app instance is missing', () => {
    mockUseAtomValue.mockReturnValue(undefined)

    render(
      <ApiKeyGenerateMenu
        environments={[createEnvironment()]}
        onCreatedToken={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'deployments.access.api.newKey' })).toBeDisabled()
  })
})
