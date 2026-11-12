import type { HumanInputFormData } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType } from '@/app/components/workflow/types'
import HumanInputForm from '../human-input-form'

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_HITL_IM: false,
}))

const formData = (form_version: '1' | '2'): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'node-1',
  node_title: 'Approval',
  display_in_ui: true,
  expiration_time: 0,
  form_token: 'token-1',
  form_version,
  form_content: '{{#$output.summary#}}',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'summary',
      default: { type: 'constant', value: 'Initial response', selector: [] },
    },
  ],
  actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
  resolved_default_values: {},
})

it('hides V2 controls behind the disabled build-time gate while preserving the legacy form', () => {
  const { rerender } = render(<HumanInputForm formData={formData('2')} onSubmit={vi.fn()} />)

  expect(screen.getByRole('status')).toHaveTextContent('share.humanInputV2.unavailable')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()

  rerender(<HumanInputForm formData={formData('1')} onSubmit={vi.fn()} />)

  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'summary' })).toHaveValue('Initial response')
  expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
})
