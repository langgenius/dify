import type { AccessPolicy, Environment } from '@dify/contracts/enterprise/types.gen'
import { AccessMode } from '@dify/contracts/enterprise/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EnvironmentPermissionRow } from '../permissions'

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

function createAccessPolicy(): AccessPolicy {
  return {
    id: 'policy-1',
    appInstanceId: 'app-instance-1',
    environmentId: 'environment-1',
    mode: AccessMode.ACCESS_MODE_PRIVATE_ALL,
    subjects: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('EnvironmentPermissionRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutate.mockImplementation((_variables: unknown, options?: { onError?: () => void }) => {
      options?.onError?.()
    })
    mockUseMutation.mockReturnValue({
      isPending: false,
      mutate: mockMutate,
    })
  })

  it('should keep the previous permission visible when updating the policy fails', () => {
    render(
      <table>
        <tbody>
          <EnvironmentPermissionRow
            appInstanceId="app-instance-1"
            environment={createEnvironment()}
            summaryPolicy={createAccessPolicy()}
          />
        </tbody>
      </table>,
    )

    fireEvent.click(screen.getByRole('button', { name: /deployments\.access\.permissions\.editAriaLabel/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'app.accessControlDialog.accessItems.anyone' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockMutate).toHaveBeenCalled()
    expect(screen.getByText('deployments.access.permission.organization')).toBeInTheDocument()
  })
})
