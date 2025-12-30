import type { CustomCollectionBackend, CustomParamSchema } from '@/app/components/tools/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthType } from '@/app/components/tools/types'
import I18n from '@/context/i18n'
import { testAPIAvailable } from '@/service/tools'
import TestApi from './test-api'

vi.mock('@/service/tools', () => ({
  testAPIAvailable: vi.fn(),
}))
const testAPIAvailableMock = vi.mocked(testAPIAvailable)

describe('TestApi', () => {
  const customCollection: CustomCollectionBackend = {
    provider: 'custom',
    credentials: {
      auth_type: AuthType.none,
    },
    schema_type: 'openapi',
    schema: '{ }',
    icon: { background: '', content: '' },
    privacy_policy: '',
    custom_disclaimer: '',
    id: 'test-id',
    labels: [],
  }
  const tool: CustomParamSchema = {
    operation_id: 'testOp',
    summary: 'summary',
    method: 'GET',
    server_url: 'https://api.example.com',
    parameters: [{
      name: 'limit',
      label: {
        en_US: 'Limit',
        zh_Hans: '限制',
      },
      // eslint-disable-next-line ts/no-explicit-any
    } as any],
  }

  const renderTestApi = () => {
    const providerValue = {
      locale: 'en-US',
      i18n: {},
      setLocaleOnClient: vi.fn(),
    }
    return render(
      <I18n.Provider value={providerValue as any}>
        <TestApi
          customCollection={customCollection}
          tool={tool}
          onHide={vi.fn()}
        />
      </I18n.Provider>,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders parameters and runs the API test', async () => {
    testAPIAvailableMock.mockResolvedValueOnce({ result: 'ok' })
    renderTestApi()

    const parameterInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(parameterInput, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'tools.test.title' }))

    await waitFor(() => {
      expect(testAPIAvailableMock).toHaveBeenCalledWith({
        provider_name: customCollection.provider,
        tool_name: tool.operation_id,
        credentials: {
          auth_type: AuthType.none,
        },
        schema_type: customCollection.schema_type,
        schema: customCollection.schema,
        parameters: {
          limit: '5',
        },
      })
      expect(screen.getByText('ok')).toBeInTheDocument()
    })
  })
})
