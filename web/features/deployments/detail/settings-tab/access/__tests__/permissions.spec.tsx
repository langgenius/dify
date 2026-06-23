import type { AccessPolicy, Environment, EnvironmentAccessPolicy } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { AccessMode, SubjectType } from '@dify/contracts/enterprise/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { EnvironmentPermissionRow } from '../permissions'
import { AccessPermissionsSection } from '../permissions-section'

const mockMutate = vi.hoisted(() => vi.fn())

vi.mock('../state', async () => {
  const { atom } = await import('jotai')

  return {
    createUpdateAccessPolicyMutationAtom: () => atom({
      isPending: false,
      mutate: mockMutate,
    }),
  }
})

function renderWithAtomStore(children: ReactNode) {
  return render(
    <JotaiProvider store={createStore()}>
      {children}
    </JotaiProvider>,
  )
}

function createEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'environment-1',
    displayName: 'Production',
    ...overrides,
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

function createSpecificAccessPolicy(): AccessPolicy {
  return {
    ...createAccessPolicy(),
    mode: AccessMode.ACCESS_MODE_PRIVATE,
    subjects: [
      {
        subjectId: 'group-1',
        subjectType: SubjectType.SUBJECT_TYPE_GROUP,
      },
      {
        subjectId: 'member-1',
        subjectType: SubjectType.SUBJECT_TYPE_ACCOUNT,
      },
    ],
  }
}

function createEnvironmentAccessPolicy(): EnvironmentAccessPolicy {
  return {
    environment: createEnvironment(),
    policy: createAccessPolicy(),
    resolvedSubjects: [],
  }
}

describe('EnvironmentPermissionRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutate.mockImplementation((_variables: unknown, options?: { onError?: () => void }) => {
      options?.onError?.()
    })
  })

  it('should keep the previous permission visible when updating the policy fails', () => {
    renderWithAtomStore(
      <EnvironmentPermissionRow
        appInstanceId="app-instance-1"
        environment={createEnvironment()}
        summaryPolicy={createAccessPolicy()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /deployments\.access\.permissions\.editAriaLabel/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'app.accessControlDialog.accessItems.anyone' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockMutate).toHaveBeenCalled()
    expect(screen.getByText('deployments.access.permission.organization')).toBeInTheDocument()
  })

  it('should show specific subject counts in the access summary', () => {
    renderWithAtomStore(
      <EnvironmentPermissionRow
        appInstanceId="app-instance-1"
        environment={createEnvironment()}
        summaryPolicy={createSpecificAccessPolicy()}
      />,
    )

    const editButton = screen.getByRole('button', { name: /deployments\.access\.permissions\.editAriaLabel/ })

    expect(editButton).toHaveTextContent('deployments.access.permission.specific')
    expect(editButton).toHaveTextContent('deployments.access.members.groupCount:{"count":1}')
    expect(editButton).toHaveTextContent('deployments.access.members.memberCount:{"count":1}')
  })
})

// Access permissions render as simple environment rows without a table header.
describe('AccessPermissionsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render permission rows without column headers', () => {
    renderWithAtomStore(
      <AccessPermissionsSection
        appInstanceId="app-instance-1"
        environmentPolicies={[createEnvironmentAccessPolicy()]}
        isLoading={false}
        isError={false}
      />,
    )

    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.queryByText('deployments.access.permissions.col.environment')).not.toBeInTheDocument()
    expect(screen.queryByText('deployments.access.permissions.col.permission')).not.toBeInTheDocument()
  })
})
