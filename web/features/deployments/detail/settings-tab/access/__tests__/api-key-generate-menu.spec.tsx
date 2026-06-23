import type { Environment } from '@dify/contracts/enterprise/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiKeyGenerateMenu } from '../api-key-generate-menu'

const mockMutate = vi.fn()
const mockUseMutation = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useMutation: (...args: unknown[]) => mockUseMutation(...args),
  }
})

function createEnvironment(): Environment {
  return {
    id: 'environment-1',
    displayName: 'Production',
  } as Environment
}

describe('ApiKeyGenerateMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue({
      isPending: false,
      mutate: mockMutate,
    })
  })

  it('should show the required name error when submitting an empty name', () => {
    render(
      <ApiKeyGenerateMenu
        appInstanceId="app-instance-1"
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
        appInstanceId="app-instance-1"
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
})
