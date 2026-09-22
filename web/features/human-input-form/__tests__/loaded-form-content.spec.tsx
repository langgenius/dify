import type { HumanInputFormDefinition, LegacyHumanInputFormData } from '../types'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType } from '@/app/components/workflow/types'
import LoadedFormContent from '../loaded-form-content'
import { normalizeLegacyHumanInputForm } from '../normalize-legacy-definition'

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

    expect(approve).toBeDisabled()
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
        ...inputs,
        {
          type: InputVarType.select,
          output_variable_name: 'reviewer',
          option_source: { type: 'constant', selector: [], value: ['Alice', 'Bob'] },
        },
      ],
    }

    render(<LoadedFormContent definition={definition} isSubmitting={false} onSubmit={onSubmit} />)
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()

    const response = screen.getByRole('textbox', { name: 'response' })
    await user.clear(response)
    await user.type(response, 'Ready for review')
    expect(approve).toBeDisabled()

    await user.click(screen.getByRole('combobox', { name: 'reviewer' }))
    await user.click(await screen.findByRole('option', { name: 'Bob' }))
    expect(approve).toBeEnabled()
    await user.click(approve)
    expect(onSubmit).toHaveBeenCalledWith(
      { response: 'Ready for review', reviewer: 'Bob' },
      'approve',
    )
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
