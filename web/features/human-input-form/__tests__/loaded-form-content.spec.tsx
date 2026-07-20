import type { HumanInputFormDefinition, LegacyHumanInputFormData } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType } from '@/app/components/workflow/types'
import LoadedFormContent from '../loaded-form-content'
import { normalizeLegacyHumanInputForm } from '../normalize-legacy-definition'

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/content-item', () => ({
  default: ({
    content,
    onInputChange,
  }: {
    content: string
    onInputChange: (name: string, value: string) => void
  }) => (
    <div>
      <span>{content}</span>
      {content.includes('response') && (
        <button type="button" onClick={() => onInputChange('response', 'updated response')}>
          update response
        </button>
      )}
    </div>
  ),
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/expiration-time', () => ({
  default: ({ expirationTime }: { expirationTime: number }) => (
    <div>expiration:{expirationTime}</div>
  ),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div>application icon</div>,
}))

vi.mock('@/app/components/base/logo/dify-logo', () => ({
  default: () => <div>dify logo</div>,
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
      await user.click(screen.getByRole('button', { name: 'update response' }))
      await user.click(screen.getByRole('button', { name: 'Approve' }))

      expect(onSubmit).toHaveBeenCalledWith({ response: 'updated response' }, 'approve')
      expect(screen.getByText('expiration:60000')).toBeInTheDocument()
      expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    },
  )

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
