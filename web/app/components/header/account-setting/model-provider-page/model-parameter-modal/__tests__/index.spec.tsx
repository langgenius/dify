import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import ModelParameterModal from '../index'

const mocks = vi.hoisted(() => ({
  openIntegrationsSetting: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/use-integrations-setting', () => ({
  useIntegrationsSetting: () => mocks.openIntegrationsSetting,
}))

vi.mock('@/service/use-common', () => ({
  useModelParameterRules: () => ({
    data: {
      data: [],
    },
    isLoading: false,
  }),
}))

vi.mock('../../hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    activeTextGenerationModelList: [],
    currentModel: undefined,
    currentProvider: undefined,
  }),
}))

vi.mock('../../model-selector', () => ({
  default: ({ onConfigureEmptyState }: { onConfigureEmptyState?: () => void }) => (
    <button type="button" onClick={onConfigureEmptyState}>
      configure-empty-model
    </button>
  ),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div>loading</div>,
}))

vi.mock('../parameter-item', () => ({
  default: () => <div>parameter-item</div>,
}))

vi.mock('../presets-parameter', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

describe('ModelParameterModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens provider settings from the model selector empty state', () => {
    render(
      <ModelParameterModal
        isAdvancedMode
        modelId=""
        provider=""
        completionParams={{}}
        setModel={vi.fn()}
        onCompletionParamsChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('configure-empty-model'))

    expect(mocks.openIntegrationsSetting).toHaveBeenCalledWith({
      payload: 'provider',
    })
  })
})
