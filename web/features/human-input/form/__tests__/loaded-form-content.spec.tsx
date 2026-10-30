import type { HumanInputFormDefinition, LegacyHumanInputFormData } from '../types'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType } from '@/app/components/workflow/types'
import LoadedFormContent from '../loaded-form-content'
import { normalizeLegacyHumanInputForm } from '../normalize-legacy-definition'

// Load the real code-split renderer before assertions start their interaction deadlines.
beforeAll(async () => {
  await import('@/app/components/base/markdown/streamdown-wrapper')
})

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/expiration-time', () => ({
  default: ({ expirationTime }: { expirationTime: number }) => (
    <div>expiration:{expirationTime}</div>
  ),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div>application icon</div>,
}))

vi.mock('@/app/components/base/logo/dify-logo', () => ({
  DifyLogo: () => <div>dify logo</div>,
}))

describe('LoadedFormContent', () => {
  const inputs: HumanInputFormDefinition['inputs'] = [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'response',
      default: {
        type: 'constant',
        value: 'initial response',
        selector: [],
      },
    },
  ]
  const actions: HumanInputFormDefinition['actions'] = [
    {
      id: 'approve',
      title: 'Approve',
      button_style: UserActionButtonType.Primary,
    },
  ]
  const legacyData: LegacyHumanInputFormData = {
    site: {
      site: {
        title: 'Legacy app',
        icon_type: 'emoji',
        icon: 'L',
        icon_background: '#fff',
        icon_url: '',
      },
    },
    form_content: '{{#$output.response#}}',
    inputs,
    resolved_default_values: {},
    user_actions: actions,
    expiration_time: 60,
  }
  const v2Definition: HumanInputFormDefinition = {
    formContent: '{{#$output.response#}}',
    inputs,
    resolvedDefaultValues: {},
    actions,
    expirationTime: 60,
  }

  it.each([
    ['legacy', normalizeLegacyHumanInputForm(legacyData)],
    ['v2', v2Definition],
  ] as const)(
    'renders and processes the version-neutral %s definition',
    async (_version, definition) => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(<LoadedFormContent definition={definition} isSubmitting={false} onSubmit={onSubmit} />)
      const response = screen.getByRole('textbox', { name: 'response' })
      expect(response).toHaveValue('initial response')
      await user.clear(response)
      await user.type(response, 'updated response')
      await user.click(screen.getByRole('button', { name: 'Approve' }))

      expect(onSubmit).toHaveBeenCalledWith({ response: 'updated response' }, 'approve')
      expect(screen.getByText('expiration:60000')).toBeInTheDocument()
      expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    },
  )

  it('blocks repeated submissions until the pending action resolves', async () => {
    const user = userEvent.setup()
    let finishSubmission: (() => void) | undefined
    const submission = new Promise<void>((resolve) => {
      finishSubmission = resolve
    })
    const onSubmit = vi.fn().mockReturnValue(submission)

    render(<LoadedFormContent definition={v2Definition} isSubmitting={false} onSubmit={onSubmit} />)
    const approve = screen.getByRole('button', { name: 'Approve' })
    await user.click(approve)

    expect(approve).toHaveAttribute('aria-disabled', 'true')
    await user.click(approve)
    expect(onSubmit).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishSubmission?.()
      await submission
    })
    expect(approve).toBeEnabled()
  })

  it('requires nonblank text and a selected option before submitting their values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const definition: HumanInputFormDefinition = {
      ...v2Definition,
      formContent: '{{#$output.response#}}\n\n{{#$output.reviewer#}}',
      resolvedDefaultValues: { response: '   ' },
      inputs: [
        {
          type: InputVarType.paragraph,
          output_variable_name: 'response',
          default: { type: 'constant', value: '   ', selector: [] },
        },
        {
          type: InputVarType.select,
          output_variable_name: 'reviewer',
          option_source: { type: 'constant', selector: [], value: ['Alice', 'Bob'] },
        },
      ],
    }

    render(<LoadedFormContent definition={definition} isSubmitting={false} onSubmit={onSubmit} />)
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve).toBeEnabled()
    await user.click(approve)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getAllByText(/fieldRequired/)).toHaveLength(2)

    const response = screen.getByRole('textbox', { name: 'response' })
    await user.clear(response)
    await user.type(response, 'Ready for review')
    expect(approve).toBeEnabled()

    await user.click(screen.getByRole('combobox', { name: 'reviewer' }))
    await user.click(await screen.findByRole('option', { name: 'Bob' }))
    expect(approve).toBeEnabled()
    await user.click(approve)
    expect(onSubmit).toHaveBeenCalledWith(
      { response: 'Ready for review', reviewer: 'Bob' },
      'approve',
    )
  })

  it('retains entered values and exposes a safe error when workflow submission rejects', async () => {
    const user = userEvent.setup()
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('internal transport details'))
      .mockResolvedValue(undefined)
    render(<LoadedFormContent definition={v2Definition} isSubmitting={false} onSubmit={onSubmit} />)
    const response = screen.getByRole('textbox', { name: 'response' })
    await user.clear(response)
    await user.type(response, 'Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(screen.queryByText('internal transport details')).not.toBeInTheDocument()
    expect(response).toHaveValue('Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onSubmit).toHaveBeenLastCalledWith({ response: 'Keep this draft' }, 'approve')
  })

  it('gives repeated placeholders distinct label associations while retaining a shared wire value', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <LoadedFormContent
        definition={{
          ...v2Definition,
          formContent:
            'First review\n\n{{#$output.response#}}\n\nSecond review\n\n{{#$output.response#}}',
        }}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    )
    const first = screen.getByRole('textbox', { name: 'First review' })
    const second = screen.getByRole('textbox', { name: 'Second review' })
    const firstLabelId = first.getAttribute('aria-labelledby')!
    const secondLabelId = second.getAttribute('aria-labelledby')!
    expect(firstLabelId).not.toBe(secondLabelId)
    expect(document.querySelectorAll('[id]')).toHaveLength(
      new Set([...document.querySelectorAll('[id]')].map((element) => element.id)).size,
    )
    await user.click(screen.getByText('Second review', { selector: 'label' }))
    expect(second).toHaveFocus()
    await user.clear(second)
    await user.type(second, 'One shared response')
    expect(first).toHaveValue('One shared response')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onSubmit).toHaveBeenCalledWith({ response: 'One shared response' }, 'approve')
  })

  it('preserves Markdown content alongside the editable fields', async () => {
    const definition: HumanInputFormDefinition = {
      ...v2Definition,
      formContent: [
        '# Review request',
        'Read the **summary** and [reference](https://example.com/reference). Use `status`.',
        '3. First review\n4. Final review',
        '| Field | Value |\n| --- | --- |\n| Owner | Alice |',
        '![Seasonal landscape](https://example.com/landscape.png)',
        '{{#$output.response#}}',
      ].join('\n\n'),
    }

    render(<LoadedFormContent definition={definition} isSubmitting={false} onSubmit={vi.fn()} />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Review request' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'reference' })).toHaveAttribute(
      'href',
      'https://example.com/reference',
    )
    expect(screen.getByText('summary')).toBeVisible()
    expect(await screen.findByText('status')).toBeVisible()
    const list = screen.getByRole('list')
    expect(list).toHaveAttribute('start', '3')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(
      within(screen.getByRole('table')).getByRole('cell', { name: 'Alice' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Seasonal landscape' })).toHaveAttribute(
      'src',
      'https://example.com/landscape.png',
    )
    expect(screen.getByRole('textbox', { name: 'response' })).toHaveValue('initial response')
  })

  it('renders optional branding without synthesizing it for v2', () => {
    const { unmount } = render(
      <LoadedFormContent
        definition={normalizeLegacyHumanInputForm(legacyData)}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText('Legacy app')).toBeInTheDocument()
    expect(screen.getByText('application icon')).toBeInTheDocument()
    unmount()

    render(<LoadedFormContent definition={v2Definition} isSubmitting={false} onSubmit={vi.fn()} />)
    expect(screen.queryByText('Legacy app')).not.toBeInTheDocument()
    expect(screen.queryByText('application icon')).not.toBeInTheDocument()
    expect(screen.getByText('dify logo')).toBeInTheDocument()
  })
})
