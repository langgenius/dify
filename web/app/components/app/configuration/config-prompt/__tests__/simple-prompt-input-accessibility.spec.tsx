import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ConfigContext, { useDebugConfigurationContext } from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import Prompt from '../simple-prompt-input'

const mockSetFeatures = vi.fn()
const mockEmit = vi.fn()
vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: () => ({ features: { opening: { enabled: false } }, setFeatures: mockSetFeatures }),
  }),
}))

describe('SimplePromptInput accessibility', () => {
  it.each([AppModeEnum.CHAT, AppModeEnum.COMPLETION])(
    'names the real editor from the visible section heading in %s mode',
    (mode) => {
      render(<Prompt mode={mode} promptTemplate="" promptVariables={[]} noResize />)
      const heading = screen.getByRole('heading', { level: 2 })
      expect(screen.getByRole('textbox', { name: heading.textContent! })).toHaveAttribute(
        'aria-labelledby',
        heading.id,
      )
    },
  )

  it('keeps an accessible editor name when embedded without a section heading', () => {
    render(
      <Prompt mode={AppModeEnum.CHAT} promptTemplate="" promptVariables={[]} noTitle noResize />,
    )
    expect(screen.getByRole('textbox', { name: 'appDebug.chatSubTitle' })).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})

it('applies the real generator result to the prompt, variables, and opening statement before closing', async () => {
  localStorage.clear()
  sessionStorage.clear()
  const user = userEvent.setup()
  const setModelConfig = vi.fn()
  const setPrevPromptConfig = vi.fn()
  const setIntroduction = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }).queryKey,
    { data: [] },
  )
  client.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), { data: null })
  client.setQueryData(
    consoleQuery.instructionGenerate.template.post.queryOptions({
      input: { body: { type: 'prompt' } },
    }).queryKey,
    { data: 'Describe a task' },
  )
  sessionStorage.setItem(
    'gen-data-app-1-versions',
    JSON.stringify([
      { modified: 'auto prompt', variables: ['city'], opening_statement: 'hello there' },
    ]),
  )
  function Owner() {
    const defaults = useDebugConfigurationContext()
    const { eventEmitter } = useEventEmitterContextContext()
    eventEmitter?.useSubscription(mockEmit)
    return (
      <ConfigContext.Provider
        value={{
          ...defaults,
          appId: 'app-1',
          setModelConfig,
          setPrevPromptConfig,
          setIntroduction,
        }}
      >
        <Prompt mode={AppModeEnum.CHAT} promptTemplate="Hello" promptVariables={[]} noResize />
      </ConfigContext.Provider>
    )
  }
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('/default-model?')) return Response.json({ data: null })
    throw new Error(`Unexpected request: ${url}`)
  })
  const view = renderWithConsoleQuery(
    <NuqsTestingAdapter>
      <EventEmitterContextProvider>
        <Owner />
      </EventEmitterContextProvider>
    </NuqsTestingAdapter>,
    { queryClient: client },
  )
  try {
    await user.click(screen.getByRole('button', { name: 'appDebug.operation.automatic' }))
    await user.click(await screen.findByRole('button', { name: 'appGeneration.generate.apply' }))
    expect(setModelConfig).not.toHaveBeenCalled()
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.confirm',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: 'auto prompt',
        type: 'PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER',
      }),
    )
    expect(setModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        configs: expect.objectContaining({
          prompt_template: 'auto prompt',
          prompt_variables: [expect.objectContaining({ key: 'city', name: 'city' })],
        }),
      }),
    )
    expect(setPrevPromptConfig).toHaveBeenCalledTimes(1)
    expect(setIntroduction).toHaveBeenCalledWith('hello there')
    expect(mockSetFeatures).toHaveBeenCalledWith(
      expect.objectContaining({
        opening: expect.objectContaining({ enabled: true, opening_statement: 'hello there' }),
      }),
    )
  } finally {
    view.unmount()
    client.clear()
    fetchSpy.mockRestore()
  }
})
