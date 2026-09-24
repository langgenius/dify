import type { ConsoleHumanInputFormDefinitionResponse } from '@dify/contracts/api/console/form/types.gen'
import type { UseQueryOptions } from '@tanstack/react-query'
import type { HumanInputFormDefinition } from '@/features/human-input-form/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConsoleHumanInputForm from '../form'

const { fetchForm, submitForm } = vi.hoisted(() => ({
  fetchForm: vi.fn<(token: string) => Promise<ConsoleHumanInputFormDefinitionResponse>>(),
  submitForm:
    vi.fn<
      (token: string, payload: { inputs: Record<string, unknown>; action: string }) => Promise<void>
    >(),
}))

type FormQueryOptions = Omit<
  UseQueryOptions<ConsoleHumanInputFormDefinitionResponse, Error, HumanInputFormDefinition>,
  'queryKey' | 'queryFn'
> & {
  input: { params: { form_token: string } }
  context: { silent: boolean }
}

vi.mock('@/service/client', () => ({
  consoleQuery: {
    form: {
      humanInput: {
        byFormToken: {
          get: {
            queryOptions: ({ input, context: _context, ...options }: FormQueryOptions) => ({
              ...options,
              queryKey: ['console-human-input-form', input.params.form_token],
              queryFn: () => fetchForm(input.params.form_token),
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (
    token: string,
    payload: { inputs: Record<string, unknown>; action: string },
  ) => submitForm(token, payload),
}))

vi.mock('@/hooks/use-document-title', () => ({ default: vi.fn() }))

const createDefinition = (
  overrides: ConsoleHumanInputFormDefinitionResponse = {},
): ConsoleHumanInputFormDefinitionResponse => ({
  form_content: '# {{#start.title#}}\n\n{{#$output.response#}}',
  rendered_content: '# Review the request\n\n{{#$output.response#}}',
  inputs: [
    {
      type: 'paragraph',
      output_variable_name: 'response',
      default: { type: 'variable', selector: ['start', 'response'] },
    },
  ],
  default_values: { response: 'Resolved approval notes' },
  user_actions: [
    { id: 'approve', title: 'Approve', button_style: 'primary' },
    { id: 'reject', title: 'Reject', button_style: 'default' },
  ],
  expiration_time: Math.floor(Date.now() / 1000) + 3600,
  ...overrides,
})

const renderForm = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ConsoleHumanInputForm formToken="console-token" />
    </QueryClientProvider>,
  )
}

describe('ConsoleHumanInputForm', () => {
  beforeEach(() => {
    fetchForm.mockReset().mockResolvedValue(createDefinition())
    submitForm.mockReset().mockResolvedValue(undefined)
  })

  it('renders resolved content and defaults, then submits edited values through Console', async () => {
    const user = userEvent.setup()
    renderForm()

    expect(await screen.findByRole('heading', { name: 'Review the request' })).toBeInTheDocument()
    const response = screen.getByRole('textbox', { name: 'response' })
    expect(response).toHaveValue('Resolved approval notes')
    expect(fetchForm).toHaveBeenCalledWith('console-token')
    expect(screen.queryByText('{{#start.title#}}')).not.toBeInTheDocument()

    await user.clear(response)
    await user.type(response, 'Approved after review')
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(submitForm).toHaveBeenCalledWith('console-token', {
      inputs: { response: 'Approved after review' },
      action: 'approve',
    })
    expect(await screen.findByText('share.humanInput.thanks')).toBeInTheDocument()
    expect(screen.getByText('share.humanInput.recorded')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'response' })).not.toBeInTheDocument()
  })

  it('keeps edited input after a failed submission and allows retry', async () => {
    const user = userEvent.setup()
    submitForm.mockRejectedValueOnce(
      new Response(JSON.stringify({ code: 'internal_server_error' }), { status: 500 }),
    )
    renderForm()

    const response = await screen.findByRole('textbox', { name: 'response' })
    await user.clear(response)
    await user.type(response, 'Keep these approval notes')
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('share.humanInputV2.unknownError')
    expect(response).toHaveValue('Keep these approval notes')
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve).toBeEnabled()
    await user.click(approve)

    expect(submitForm).toHaveBeenCalledTimes(2)
    expect(submitForm).toHaveBeenLastCalledWith('console-token', {
      inputs: { response: 'Keep these approval notes' },
      action: 'approve',
    })
    expect(await screen.findByText('share.humanInput.thanks')).toBeInTheDocument()
  })

  it('disables every action while submitting to prevent duplicate approvals', async () => {
    const user = userEvent.setup()
    let resolveSubmission: (() => void) | undefined
    const pendingSubmission = new Promise<void>((resolve) => {
      resolveSubmission = resolve
    })
    submitForm.mockReturnValue(pendingSubmission)
    renderForm()

    const approve = await screen.findByRole('button', { name: 'Approve' })
    const reject = screen.getByRole('button', { name: 'Reject' })
    await user.click(approve)
    expect(approve).toBeDisabled()
    expect(reject).toBeDisabled()
    await user.click(approve)
    await user.click(reject)
    expect(submitForm).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSubmission?.()
      await pendingSubmission
    })
    expect(await screen.findByText('share.humanInput.thanks')).toBeInTheDocument()
  })

  it.each([
    [{ status: 404 }, 'share.humanInput.formNotFound'],
    [
      { status: 412, data: { body: { code: 'human_input_form_expired' } } },
      'share.humanInput.expired',
    ],
    [{ code: 'human_input_form_submitted' }, 'share.humanInput.completed'],
  ])('shows a terminal state for a rejected definition: %j', async (error, expected) => {
    fetchForm.mockRejectedValue(error)
    renderForm()

    expect(await screen.findByText(expected)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
    expect(submitForm).not.toHaveBeenCalled()
  })

  it.each([
    ['human_input_form_expired', 'share.humanInput.expired'],
    ['human_input_form_submitted', 'share.humanInput.completed'],
  ])('handles a form resolved elsewhere before submission: %s', async (code, expected) => {
    const user = userEvent.setup()
    submitForm.mockRejectedValue(new Response(JSON.stringify({ code }), { status: 412 }))
    renderForm()

    await user.click(await screen.findByRole('button', { name: 'Approve' }))

    expect(await screen.findByText(expected)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(submitForm).toHaveBeenCalledTimes(1)
  })

  it('allows retry after a temporary definition load failure', async () => {
    const user = userEvent.setup()
    fetchForm.mockRejectedValueOnce({ status: 503 })
    renderForm()

    const retry = await screen.findByRole('button', { name: 'common.operation.retry' })
    expect(fetchForm).toHaveBeenCalledTimes(1)
    await user.click(retry)

    expect(await screen.findByRole('textbox', { name: 'response' })).toHaveValue(
      'Resolved approval notes',
    )
    await waitFor(() => expect(fetchForm).toHaveBeenCalledTimes(2))
  })

  it('blocks approval when Console returns a definition whose deadline has already passed', async () => {
    fetchForm.mockResolvedValue(
      createDefinition({ expiration_time: Math.floor(Date.now() / 1000) - 60 }),
    )
    renderForm()

    expect(await screen.findByText('share.humanInput.expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(submitForm).not.toHaveBeenCalled()
  })
})
