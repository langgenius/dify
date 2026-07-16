import type {
  AccessPolicy,
  Environment,
  EnvironmentAccessPolicy,
} from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { AccessMode, AccessSubjectType } from '@dify/contracts/enterprise/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { deploymentRouteAppInstanceIdAtom } from '../../../../route-state'
import {
  accessSettingsAtom,
  accessSettingsIsErrorAtom,
  accessSettingsIsLoadingAtom,
} from '../../state'
import { EnvironmentPermissionRow } from '../environment-permission-row'
import { AccessPermissionsSection } from '../section'

const mockMutate = vi.hoisted(() => vi.fn())
const mockUseAtomValue = vi.hoisted(() => vi.fn())

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()
  return {
    ...actual,
    useAtomValue: mockUseAtomValue,
  }
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useInfiniteQuery: () => ({
      data: { pages: [] },
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      isLoading: false,
    }),
    useMutation: () => ({
      isPending: false,
      mutate: mockMutate,
    }),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      accessService: {
        updateAccessPolicy: {
          mutationOptions: () => ({ mutationKey: ['updateAccessPolicy'] }),
        },
      },
    },
  },
}))

function renderWithAtomStore(children: ReactNode) {
  return render(<JotaiProvider store={createStore()}>{children}</JotaiProvider>)
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
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
      },
      {
        subjectId: 'member-1',
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
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
    mockUseAtomValue.mockImplementation((atom) => {
      if (atom === deploymentRouteAppInstanceIdAtom) return 'app-instance-1'
      return undefined
    })
    mockMutate.mockImplementation((_variables: unknown, options?: { onError?: () => void }) => {
      options?.onError?.()
    })
  })

  it('should keep the previous permission visible when updating the policy fails', () => {
    renderWithAtomStore(
      <EnvironmentPermissionRow
        environment={createEnvironment()}
        summaryPolicy={createAccessPolicy()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /deployments\.access\.permissions\.editAriaLabel/ }),
    )
    fireEvent.click(
      screen.getByRole('radio', { name: 'app.accessControlDialog.accessItems.anyone' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockMutate).toHaveBeenCalled()
    expect(screen.getByText('deployments.access.permission.organization')).toBeInTheDocument()
  })

  it('should show the updated policy after success', () => {
    mockMutate.mockImplementation((_variables: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    })

    renderWithAtomStore(
      <EnvironmentPermissionRow
        environment={createEnvironment()}
        summaryPolicy={createAccessPolicy()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /deployments\.access\.permissions\.editAriaLabel/ }),
    )
    fireEvent.click(
      screen.getByRole('radio', { name: 'app.accessControlDialog.accessItems.anyone' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockMutate).toHaveBeenCalledWith(
      {
        params: {
          appInstanceId: 'app-instance-1',
          environmentId: 'environment-1',
        },
        body: {
          appInstanceId: 'app-instance-1',
          environmentId: 'environment-1',
          mode: AccessMode.ACCESS_MODE_PUBLIC,
          subjects: [],
        },
      },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    )
    expect(screen.getByText('deployments.access.permission.anyone')).toBeInTheDocument()
  })

  it('should submit specific subjects with the deployment access subject type', () => {
    mockMutate.mockImplementation((_variables: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    })

    renderWithAtomStore(
      <EnvironmentPermissionRow
        environment={createEnvironment()}
        summaryPolicy={createSpecificAccessPolicy()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /deployments\.access\.permissions\.editAriaLabel/ }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockMutate).toHaveBeenCalledWith(
      {
        params: {
          appInstanceId: 'app-instance-1',
          environmentId: 'environment-1',
        },
        body: {
          appInstanceId: 'app-instance-1',
          environmentId: 'environment-1',
          mode: AccessMode.ACCESS_MODE_PRIVATE,
          subjects: [
            {
              subjectId: 'group-1',
              subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
            },
            {
              subjectId: 'member-1',
              subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
            },
          ],
        },
      },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    )
  })

  it('should show specific subject counts in the access summary', () => {
    renderWithAtomStore(
      <EnvironmentPermissionRow
        environment={createEnvironment()}
        summaryPolicy={createSpecificAccessPolicy()}
      />,
    )

    const editButton = screen.getByRole('button', {
      name: /deployments\.access\.permissions\.editAriaLabel/,
    })

    expect(editButton).toHaveTextContent('deployments.access.permission.specific')
    expect(editButton).toHaveTextContent('deployments.access.members.groupCount:{"count":1}')
    expect(editButton).toHaveTextContent('deployments.access.members.memberCount:{"count":1}')
  })
})

// Access permissions render as simple environment rows without a table header.
describe('AccessPermissionsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAtomValue.mockImplementation((atom) => {
      if (atom === deploymentRouteAppInstanceIdAtom) return 'app-instance-1'
      if (atom === accessSettingsAtom) {
        return {
          environmentPolicies: [createEnvironmentAccessPolicy()],
        }
      }
      if (atom === accessSettingsIsLoadingAtom) return false
      if (atom === accessSettingsIsErrorAtom) return false
      return undefined
    })
  })

  it('should render permission rows without column headers', () => {
    renderWithAtomStore(<AccessPermissionsSection />)

    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(
      screen.queryByText('deployments.access.permissions.col.environment'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('deployments.access.permissions.col.permission'),
    ).not.toBeInTheDocument()
  })
})
