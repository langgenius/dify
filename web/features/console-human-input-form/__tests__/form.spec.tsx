import type { ConsoleHumanInputV2FormDefinitionResponse } from '@dify/contracts/api/console/form/types.gen'
import type { UseQueryOptions } from '@tanstack/react-query'
import type { HumanInputFormDefinition } from '@/features/human-input-form/types'
import type { consoleClient } from '@/service/console'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConsoleHumanInputForm from '../form'

type ConsoleFormSubmitInput = Parameters<
  typeof consoleClient.form.humanInput.v2.byFormToken.post
>[0]

const { fetchForm, fetchLegacyForm, submitForm, submitLegacyForm } = vi.hoisted(() => ({
  fetchForm: vi.fn<(token: string) => Promise<ConsoleHumanInputV2FormDefinitionResponse>>(),
  fetchLegacyForm: vi.fn(),
  submitForm: vi.fn<(input: ConsoleFormSubmitInput) => Promise<Record<string, unknown>>>(),
  submitLegacyForm: vi.fn(),
}))

type FormQueryOptions = Omit<
  UseQueryOptions<ConsoleHumanInputV2FormDefinitionResponse, Error, HumanInputFormDefinition>,
  'queryKey' | 'queryFn'
> & {
  input: { params: { form_token: string } }
  context: { silent: boolean }
}

vi.mock('@/service/console', () => ({
  consoleQuery: {
    form: {
      humanInput: {
        byFormToken: {
          get: {
            queryOptions: ({ input, context: _context, ...options }: FormQueryOptions) => ({
              ...options,
              queryKey: ['legacy-console-human-input-form', input.params.form_token],
              queryFn: () => fetchLegacyForm(input.params.form_token),
            }),
          },
        },
        v2: {
          byFormToken: {
            get: {
              queryOptions: ({ input, context: _context, ...options }: FormQueryOptions) => ({
                ...options,
                queryKey: ['console-human-input-v2-form', input.params.form_token],
                queryFn: () => fetchForm(input.params.form_token),
              }),
            },
            post: {
              mutationOptions: () => ({
                mutationFn: (input: ConsoleFormSubmitInput) => submitForm(input),
              }),
            },
          },
        },
      },
    },
  },
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: submitLegacyForm,
}))

vi.mock('@/hooks/use-document-title', () => ({ default: vi.fn() }))

const createDefinition = (
  overrides: Partial<ConsoleHumanInputV2FormDefinitionResponse> = {},
): ConsoleHumanInputV2FormDefinitionResponse => ({
  resolved_form: {
    title: 'Console approval',
    legacy_form_content: '# {{#start.title#}}\n\n{{#$output.response#}}',
    parts: [
      { type: 'markdown_fragment', text: '# Review the request\n\n' },
      {
        type: 'paragraph_input',
        output_variable_name: 'response',
        default_value: 'Resolved approval notes',
      },
    ],
    actions: [
      { id: 'approve', title: 'Approve', button_style: 'primary' },
      { id: 'reject', title: 'Reject', button_style: 'default' },
    ],
  },
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
    fetchLegacyForm.mockReset().mockRejectedValue({ status: 404 })
    submitForm.mockReset().mockResolvedValue({})
    submitLegacyForm.mockReset()
  })

  it('reads and submits the resolved Console form using only the new Console API', async () => {
    const user = userEvent.setup()
    renderForm()

    expect(await screen.findByRole('heading', { name: 'Review the request' })).toBeInTheDocument()
    const response = screen.getByRole('textbox', { name: 'response' })
    expect(response).toHaveValue('Resolved approval notes')
    expect(fetchForm).toHaveBeenCalledWith('console-token')
    expect(fetchLegacyForm).not.toHaveBeenCalled()
    expect(screen.queryByText('{{#start.title#}}')).not.toBeInTheDocument()

    await user.clear(response)
    await user.type(response, 'Approved after review')
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(submitForm).toHaveBeenCalledWith({
      params: { form_token: 'console-token' },
      body: { inputs: { response: 'Approved after review' }, action: 'approve' },
    })
    expect(submitLegacyForm).not.toHaveBeenCalled()
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
    expect(submitForm).toHaveBeenLastCalledWith({
      params: { form_token: 'console-token' },
      body: { inputs: { response: 'Keep these approval notes' }, action: 'approve' },
    })
    expect(await screen.findByText('share.humanInput.thanks')).toBeInTheDocument()
  })

  it('disables every action while submitting to prevent duplicate approvals', async () => {
    const user = userEvent.setup()
    let resolveSubmission: ((value: Record<string, unknown>) => void) | undefined
    const pendingSubmission = new Promise<Record<string, unknown>>((resolve) => {
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
      resolveSubmission?.({})
      await pendingSubmission
    })
    expect(await screen.findByText('share.humanInput.thanks')).toBeInTheDocument()
  })

  it.each([
    [{ status: 404 }, 'share.humanInput.formNotFound'],
    [{ status: 410, data: { body: { code: 'expired' } } }, 'share.humanInput.expired'],
    [{ status: 409, code: 'already_submitted' }, 'share.humanInput.completed'],
    [new Response(null, { status: 409 }), 'share.humanInput.completed'],
  ])('shows a terminal state for a rejected definition: %j', async (error, expected) => {
    fetchForm.mockRejectedValue(error)
    renderForm()

    expect(await screen.findByText(expected)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
    expect(submitForm).not.toHaveBeenCalled()
    expect(fetchLegacyForm).not.toHaveBeenCalled()
    expect(submitLegacyForm).not.toHaveBeenCalled()
  })

  it.each([
    ['expired', 'share.humanInput.expired'],
    ['already_submitted', 'share.humanInput.completed'],
  ])('handles a form resolved elsewhere before submission: %s', async (code, expected) => {
    const user = userEvent.setup()
    submitForm.mockRejectedValue(
      new Response(JSON.stringify({ code }), { status: code === 'expired' ? 410 : 409 }),
    )
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
