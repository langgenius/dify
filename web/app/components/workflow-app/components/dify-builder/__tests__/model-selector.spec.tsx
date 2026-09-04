import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import DifyBuilderModelSelector from '../model-selector'
import { difyBuilderSelectedModelAtom } from '../store'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({ data: null }),
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    activeTextGenerationModelList: [],
  }),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: ({ trigger }: { trigger: ReactElement }) => trigger,
  }),
)

describe('DifyBuilderModelSelector', () => {
  it('uses the visible model name as the trigger accessible name', () => {
    const store = createStore()
    store.set(difyBuilderSelectedModelAtom, {
      provider: 'openai',
      name: 'gpt-4o',
      mode: 'chat',
      completion_params: {},
    })

    render(
      <Provider store={store}>
        <DifyBuilderModelSelector />
      </Provider>,
    )

    expect(screen.getByRole('button', { name: 'gpt-4o' })).toBeInTheDocument()
  })
})
