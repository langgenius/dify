import type { CredentialSlot, Environment } from '@dify/contracts/enterprise/types.gen'
import { Buffer } from 'node:buffer'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateDeploymentGuide } from '../index'

type QueryOptions = {
  queryKey?: string[]
  enabled?: boolean
}

type QueryResult = {
  data?: unknown
  isLoading: boolean
  isFetching: boolean
  isError: boolean
}

type MutationOptions = {
  mutationFn: (variables: unknown) => Promise<unknown>
}

const mocks = vi.hoisted(() => ({
  createInitialDeploymentFromDsl: vi.fn(),
  createInitialDeploymentFromSourceApp: vi.fn(),
  getDeploymentOptionsFromDslQueryOptions: vi.fn(),
  push: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: () => ({
    data: {
      pages: [
        {
          data: [],
          has_more: false,
          page: 1,
        },
      ],
    },
    isLoading: false,
    isFetching: false,
  }),
  useMutation: (options: MutationOptions) => ({
    isPending: false,
    mutateAsync: options.mutationFn,
  }),
  useQuery: (options: QueryOptions) => {
    if (options.enabled === false)
      return queryResult()

    switch (options.queryKey?.[0]) {
      case 'deployable-environments':
        return queryResult({ data: { data: [environment()] } })
      case 'dsl-deployment-options':
        return queryResult({
          data: {
            options: {
              dslDigest: 'dsl-digest-1',
              credentialSlots: [credentialSlot()],
            },
          },
        })
      case 'source-deployment-options':
      default:
        return queryResult()
    }
  },
}))

vi.mock('@/next/link', () => ({
  default: ({ children, href, className, 'aria-label': ariaLabel }: {
    'children': React.ReactNode
    'href': string
    'className'?: string
    'aria-label'?: string
  }) => (
    <a href={href} className={className} aria-label={ariaLabel}>{children}</a>
  ),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      list: {
        infiniteOptions: (options: unknown) => ({
          queryKey: ['apps'],
          ...options as Record<string, unknown>,
        }),
      },
    },
    enterprise: {
      environmentService: {
        listDeployableEnvironments: {
          queryOptions: (options: unknown) => ({
            queryKey: ['deployable-environments'],
            ...options as Record<string, unknown>,
          }),
        },
      },
      releaseService: {
        getDeploymentOptionsFromDsl: {
          queryOptions: (options: unknown) => {
            mocks.getDeploymentOptionsFromDslQueryOptions(options)

            return {
              queryKey: ['dsl-deployment-options'],
              ...options as Record<string, unknown>,
            }
          },
        },
        getDeploymentOptionsFromSourceApp: {
          queryOptions: (options: unknown) => ({
            queryKey: ['source-deployment-options'],
            ...options as Record<string, unknown>,
          }),
        },
      },
      deploymentService: {
        createInitialDeploymentFromDsl: {
          mutationOptions: () => ({
            mutationFn: mocks.createInitialDeploymentFromDsl,
          }),
        },
        createInitialDeploymentFromSourceApp: {
          mutationOptions: () => ({
            mutationFn: mocks.createInitialDeploymentFromSourceApp,
          }),
        },
      },
    },
  },
}))

function queryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    ...overrides,
  }
}

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'env-1',
    name: 'Production',
    mode: 2,
    backend: 1,
    status: 3,
    ...overrides,
  }
}

function credentialSlot(overrides: Partial<CredentialSlot> = {}): CredentialSlot {
  return {
    providerId: 'openai',
    category: 1,
    candidates: [
      {
        credentialId: 'cred-1',
        providerId: 'openai',
        displayName: 'OpenAI key',
      },
    ],
    ...overrides,
  }
}

function getFileInput(container: HTMLElement) {
  const fileInput = container.querySelector('input[type="file"]')

  if (!(fileInput instanceof HTMLInputElement))
    throw new Error('DSL file input was not rendered.')

  return fileInput
}

describe('CreateDeploymentGuide', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createInitialDeploymentFromDsl.mockResolvedValue({
      appInstance: {
        id: 'instance-1',
      },
    })
  })

  // The DSL path should call the enterprise initial deployment endpoint instead of the old placeholder flow.
  describe('DSL import deployment', () => {
    it('should create an initial deployment from the uploaded DSL', async () => {
      // Arrange
      const { container } = render(<CreateDeploymentGuide />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /createGuide\.methods\.importDsl\.title/ }))
      fireEvent.change(getFileInput(container), {
        target: {
          files: [
            new File(['app: 🤖'], 'demo.yml', { type: 'text/yaml' }),
          ],
        },
      })

      await waitFor(() => {
        expect(screen.getByText('demo.yml')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /createGuide\.actions\.next/ })).toBeEnabled()
      })

      fireEvent.click(screen.getByRole('button', { name: /createGuide\.actions\.next/ }))
      fireEvent.click(screen.getByRole('button', { name: /createGuide\.actions\.next/ }))

      await waitFor(() => {
        expect(screen.getAllByText('Production').length).toBeGreaterThan(0)
        expect(screen.getByRole('button', { name: /createGuide\.actions\.deploy/ })).toBeEnabled()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /createGuide\.actions\.deploy/ }))
      })

      // Assert
      await waitFor(() => {
        const expectedEncodedDsl = Buffer.from('app: 🤖', 'utf8').toString('base64')
        expect(mocks.getDeploymentOptionsFromDslQueryOptions).toHaveBeenCalledWith({
          input: {
            body: {
              dsl: expectedEncodedDsl,
            },
          },
          enabled: true,
        })
        expect(mocks.createInitialDeploymentFromDsl).toHaveBeenCalledWith({
          body: {
            dsl: expectedEncodedDsl,
            environmentId: 'env-1',
            appInstanceName: 'deployments.createGuide.dsl.defaultAppName',
            appInstanceDescription: undefined,
            releaseName: 'deployments.createGuide.release.defaultName',
            releaseDescription: undefined,
            credentials: [
              {
                providerId: 'openai',
                category: 1,
                credentialId: 'cred-1',
              },
            ],
            idempotencyKey: expect.stringMatching(/^.{1,128}$/),
            expectedDslDigest: 'dsl-digest-1',
          },
        })
        expect(mocks.createInitialDeploymentFromSourceApp).not.toHaveBeenCalled()
        expect(mocks.push).toHaveBeenCalledWith('/deployments/instance-1/overview')
      })
    })
  })
})
