import type { PluginTriggerNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { isErrorHandled } from '@/service/handled-error'
import { createHttpError } from '@/service/http-error'
import Panel from '../panel'

const { mockUseConfig } = vi.hoisted(() => ({ mockUseConfig: vi.fn() }))
vi.mock('../use-config', () => ({ default: mockUseConfig }))

const unavailable = () =>
  createHttpError(
    { status: 503, statusText: '', headers: new Headers() },
    { message: 'Trigger plugins unavailable' },
  )

const loadedQuery = () => ({
  data: [],
  error: null,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
})

const configWith = (loadQueries: unknown[]) => ({
  readOnly: false,
  triggerParameterSchema: [],
  triggerParameterValue: {},
  setTriggerParameterValue: vi.fn(),
  outputSchema: { properties: {} },
  hasObjectOutput: false,
  currentProvider: undefined,
  currentEvent: undefined,
  subscriptionSelected: undefined,
  loadQueries,
})

const data = { type: BlockEnum.TriggerPlugin } as PluginTriggerNodeType
const panelProps = {} as NodePanelProps<PluginTriggerNodeType>['panelProps']

describe('TriggerPluginPanel', () => {
  it('renders a failed first load inline and claims it, so the cache does not also toast it', async () => {
    const user = userEvent.setup()
    const error = unavailable()
    const failed = { data: undefined, error, isError: true, isFetching: false, refetch: vi.fn() }
    mockUseConfig.mockReturnValue(configWith([failed, loadedQuery()]))

    render(<Panel id="trigger" data={data} panelProps={panelProps} />)

    expect(screen.getByRole('alert')).toHaveTextContent('workflow.common.loadFailed')
    expect(isErrorHandled(error)).toBe(true)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(failed.refetch).toHaveBeenCalledOnce()
  })

  it('leaves a failed refresh over loaded lists to the cache', () => {
    const error = unavailable()
    mockUseConfig.mockReturnValue(
      configWith([{ ...loadedQuery(), error, isError: true }, loadedQuery()]),
    )

    render(<Panel id="trigger" data={data} panelProps={panelProps} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(isErrorHandled(error)).toBe(false)
  })
})
