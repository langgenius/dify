import type { AccessChannels, AccessEndpoint } from '@dify/contracts/enterprise/types.gen'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deploymentRouteAppInstanceIdAtom } from '../../../../route-state'
import {
  accessSettingsAtom,
  accessSettingsIsErrorAtom,
  accessSettingsIsLoadingAtom,
} from '../../state'
import { AccessChannelsSection } from '../section'

const mockToggleAccessChannel = vi.hoisted(() => vi.fn())
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
    useMutation: () => ({
      isPending: false,
      mutate: mockToggleAccessChannel,
    }),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      accessService: {
        updateAccessChannels: {
          mutationOptions: () => ({ mutationKey: ['updateAccessChannels'] }),
        },
      },
    },
  },
}))

function createAccessChannels(): AccessChannels {
  return {
    id: 'access-channels-1',
    appInstanceId: 'app-instance-1',
    webAppEnabled: true,
    developerApiEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as AccessChannels
}

function createEndpoint(endpointUrl: string): AccessEndpoint {
  return {
    environment: {
      id: 'environment-1',
      displayName: 'Production',
    },
    endpointUrl,
  } as AccessEndpoint
}

// Access channel rows keep their title, description, and endpoint content together.
describe('AccessChannelsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAtomValue.mockImplementation((atom) => {
      if (atom === deploymentRouteAppInstanceIdAtom) return 'app-instance-1'
      if (atom === accessSettingsAtom) {
        return {
          accessChannels: createAccessChannels(),
          webAppEndpoints: [createEndpoint('https://app.example.com/webapp')],
          cliEndpoint: createEndpoint('https://cli.example.com/entry'),
        }
      }
      if (atom === accessSettingsIsLoadingAtom) return false
      if (atom === accessSettingsIsErrorAtom) return false
      return undefined
    })
  })

  it('should render channel descriptions when access channels are enabled', () => {
    render(<AccessChannelsSection />)

    expect(screen.getByText('deployments.access.runAccess.webappDesc')).toBeInTheDocument()
    expect(screen.getByText('deployments.access.cli.description')).toBeInTheDocument()
  })
})
