import type { Environment } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'
import { ApiKeyGenerateMenu } from '../api-key-generate-menu'

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

function renderMenu(appInstanceId?: string) {
  const store = createStore()
  store.set(setNextRouteStateAtom, {
    pathname: '/deployments/app-instance-1/api-tokens',
    params: appInstanceId ? { appInstanceId } : {},
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={store}>{children}</JotaiProvider>
  )

  return render(
    <ApiKeyGenerateMenu environments={[createEnvironment()]} onCreatedToken={vi.fn()} />,
    { wrapper },
  )
}

describe('ApiKeyGenerateMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show the required name error when submitting an empty name', () => {
    renderMenu('app-instance-1')

    fireEvent.click(screen.getByRole('button', { name: 'deployments.access.api.newKey' }))
    fireEvent.change(screen.getByLabelText('deployments.access.api.nameLabel'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'deployments.access.api.createKey' }))

    expect(screen.getByText('deployments.access.api.nameRequired')).toBeInTheDocument()
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('should clear the required name error when typing a valid name', () => {
    renderMenu('app-instance-1')

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
    renderMenu(undefined)

    expect(screen.getByRole('button', { name: 'deployments.access.api.newKey' })).toBeDisabled()
  })
})
