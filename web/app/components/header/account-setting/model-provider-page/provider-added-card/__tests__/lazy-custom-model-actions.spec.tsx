import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import LazyCustomModelActions from '../lazy-custom-model-actions'

const { mockLoadProviderDetail, mockOpenModelModal, providerDetail } = vi.hoisted(() => {
  const providerDetail = {
    provider: 'langgenius/openai/openai',
    custom_configuration: {
      custom_models: [{ model: 'custom-gpt' }],
      can_added_models: [{ model: 'custom-gpt-2', model_type: 'llm' }],
    },
  }

  return {
    mockLoadProviderDetail: vi.fn().mockResolvedValue(providerDetail),
    mockOpenModelModal: vi.fn(),
    providerDetail,
  }
})

vi.mock('../../hooks', async () => {
  const { useState } = await import('react')

  return {
    useLazyModelProviderDetail: () => {
      const [detail, setDetail] = useState<typeof providerDetail>()

      return {
        providerDetail: detail,
        loadProviderDetail: async () => {
          const loadedDetail = await mockLoadProviderDetail()
          setDetail(loadedDetail)
          return loadedDetail
        },
        isLoadingProviderDetail: false,
      }
    },
    useModelModalHandler: () => mockOpenModelModal,
  }
})

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  AddCustomModel: ({ open }: { open?: boolean }) => (
    <div data-open={open} data-testid="add-custom-model" />
  ),
  ManageCustomModelCredentials: ({ isOpen }: { isOpen?: boolean }) => (
    <div data-open={isOpen} data-testid="manage-custom-model" />
  ),
}))

const createProvider = (hasCustomModels: boolean) =>
  ({
    provider: 'langgenius/openai/openai',
    custom_configuration: {
      has_custom_models: hasCustomModels,
    },
  }) as ModelProviderSummaryResponse

describe('LazyCustomModelActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads provider detail and opens credential management on demand', async () => {
    const user = userEvent.setup()
    render(<LazyCustomModelActions provider={createProvider(true)} />)

    expect(mockLoadProviderDetail).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'common.modelProvider.auth.manageCredentials' }),
    )

    expect(await screen.findByTestId('manage-custom-model')).toHaveAttribute('data-open', 'true')
    expect(mockLoadProviderDetail).toHaveBeenCalledTimes(1)
  })

  it('does not render credential management without custom models', () => {
    render(<LazyCustomModelActions provider={createProvider(false)} />)

    expect(
      screen.queryByRole('button', { name: 'common.modelProvider.auth.manageCredentials' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'common.modelProvider.addModel' }),
    ).toBeInTheDocument()
  })
})
