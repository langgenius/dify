import { Buffer } from 'node:buffer'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateReleaseControl } from '../create-release-control'

type MutationOptions = {
  mutationKey?: string[]
}

type MutationVariables = {
  body: Record<string, unknown>
}

type MutationCallbacks = {
  onSuccess?: (response: { release?: { id?: string, name?: string } }) => void
  onError?: () => void
}

type MutationResult = {
  isPending: boolean
  mutate: (variables: MutationVariables, callbacks?: MutationCallbacks) => void
}

type QueryOptions = {
  queryKey?: string[]
}

type LatestReleaseResponse = {
  data: Array<{
    sourceAppId?: string
  }>
}

const mocks = vi.hoisted(() => ({
  createReleaseFromDslMutate: vi.fn(),
  createReleaseFromSourceAppMutate: vi.fn(),
  latestReleaseResponse: undefined as LatestReleaseResponse | undefined,
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  skipToken: Symbol('skipToken'),
  useInfiniteQuery: () => ({
    data: {
      pages: [
        {
          data: [
            {
              id: 'source-app-1',
              name: 'Source app',
              mode: 'workflow',
            },
          ],
          has_more: false,
          page: 1,
        },
      ],
    },
    isLoading: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
  }),
  useQuery: (options: QueryOptions) => {
    if (options.queryKey?.[0] === 'latest-release') {
      return {
        data: mocks.latestReleaseResponse,
        isLoading: false,
        isError: false,
      }
    }

    if (options.queryKey?.[0] === 'source-app') {
      return {
        data: {
          id: options.queryKey[1],
          name: 'Previous source app',
        },
        isLoading: false,
        isError: false,
      }
    }

    return {
      data: undefined,
      isLoading: false,
      isError: false,
    }
  },
  useMutation: (options: MutationOptions): MutationResult => {
    if (options.mutationKey?.[0] === 'create-release-from-dsl') {
      return {
        isPending: false,
        mutate: mocks.createReleaseFromDslMutate,
      }
    }

    return {
      isPending: false,
      mutate: mocks.createReleaseFromSourceAppMutate,
    }
  },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      list: {
        infiniteOptions: () => ({}),
      },
      byAppId: {
        get: {
          queryOptions: ({ input }: { input?: { params?: { app_id?: string } } }) => ({ queryKey: ['source-app', input?.params?.app_id] }),
        },
      },
    },
    enterprise: {
      releaseService: {
        listReleases: {
          queryOptions: () => ({ queryKey: ['latest-release'] }),
        },
        createReleaseFromDsl: {
          mutationOptions: () => ({ mutationKey: ['create-release-from-dsl'] }),
        },
        createReleaseFromSourceApp: {
          mutationOptions: () => ({ mutationKey: ['create-release-from-source-app'] }),
        },
      },
    },
  },
}))

describe('CreateReleaseControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.latestReleaseResponse = undefined
  })

  // The release form should let users choose a manual DSL upload instead of a source app.
  describe('Release source', () => {
    it('should create a release from a selected source app without creating a new app instance', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<CreateReleaseControl appInstanceId="instance-1" />)

      // Act
      await user.click(screen.getByRole('button', { name: 'deployments.versions.createRelease' }))
      const dialog = screen.getByRole('dialog', { name: 'deployments.versions.createRelease' })
      await user.click(within(dialog).getByRole('combobox', { name: 'deployments.versions.sourceAppOption' }))
      await user.click(screen.getByText('Source app'))
      await user.type(
        within(dialog).getByRole('textbox', { name: 'deployments.versions.releaseNameLabel' }),
        'Release 1',
      )
      await user.click(within(dialog).getByRole('button', { name: 'deployments.versions.create' }))

      // Assert
      expect(mocks.createReleaseFromSourceAppMutate).toHaveBeenCalledWith(
        {
          body: {
            appInstanceId: 'instance-1',
            sourceAppId: 'source-app-1',
            name: 'Release 1',
            description: undefined,
            createAppInstance: false,
          },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      )
      expect(mocks.createReleaseFromDslMutate).not.toHaveBeenCalled()
    })

    it('should default to the latest release source app when available', async () => {
      // Arrange
      const user = userEvent.setup()
      mocks.latestReleaseResponse = {
        data: [
          {
            sourceAppId: 'previous-source-app',
          },
        ],
      }
      render(<CreateReleaseControl appInstanceId="instance-1" />)

      // Act
      await user.click(screen.getByRole('button', { name: 'deployments.versions.createRelease' }))
      const dialog = screen.getByRole('dialog', { name: 'deployments.versions.createRelease' })
      await user.type(
        within(dialog).getByRole('textbox', { name: 'deployments.versions.releaseNameLabel' }),
        'Release 2',
      )
      await user.click(within(dialog).getByRole('button', { name: 'deployments.versions.create' }))

      // Assert
      expect(within(dialog).getByText('Previous source app')).toBeInTheDocument()
      expect(mocks.createReleaseFromSourceAppMutate).toHaveBeenCalledWith(
        {
          body: {
            appInstanceId: 'instance-1',
            sourceAppId: 'previous-source-app',
            name: 'Release 2',
            description: undefined,
            createAppInstance: false,
          },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      )
      expect(mocks.createReleaseFromDslMutate).not.toHaveBeenCalled()
    })

    it('should create a release from an uploaded DSL when DSL mode is selected', async () => {
      // Arrange
      const user = userEvent.setup()
      const dslContent = 'version: 0.1.0\nkind: app\napp:\n  name: DSL App\n'
      render(<CreateReleaseControl appInstanceId="instance-1" />)

      // Act
      await user.click(screen.getByRole('button', { name: 'deployments.versions.createRelease' }))
      const dialog = screen.getByRole('dialog', { name: 'deployments.versions.createRelease' })
      await user.click(within(dialog).getByRole('button', { name: 'deployments.versions.manualDslOption' }))

      const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')
      if (!fileInput)
        throw new Error('DSL file input was not rendered.')

      await user.upload(
        fileInput,
        new File([dslContent], 'release.yml', { type: 'text/yaml' }),
      )
      await waitFor(() => {
        expect(within(dialog).getByText('release.yml')).toBeInTheDocument()
      })
      await user.type(
        within(dialog).getByRole('textbox', { name: 'deployments.versions.releaseNameLabel' }),
        'Release 1',
      )
      await user.click(within(dialog).getByRole('button', { name: 'deployments.versions.create' }))

      // Assert
      expect(mocks.createReleaseFromDslMutate).toHaveBeenCalledWith(
        {
          body: {
            appInstanceId: 'instance-1',
            dsl: Buffer.from(dslContent, 'utf8').toString('base64'),
            name: 'Release 1',
            description: undefined,
            createAppInstance: false,
          },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      )
      expect(mocks.createReleaseFromSourceAppMutate).not.toHaveBeenCalled()
    })
  })
})
