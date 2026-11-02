import type { HumanInputNodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import Panel from '../panel'
import { DeliveryMethodType, UserActionButtonType } from '../types'

const hitlIm = vi.hoisted(() => ({ enabled: true }))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return hitlIm.enabled
  },
}))

const createData = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [{ id: 'dm-webapp', type: DeliveryMethodType.WebApp, enabled: true }],
  form_content: 'Please review this request',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'review_result',
      default: { selector: [], type: 'constant', value: '' },
    },
  ],
  user_actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
  timeout: 3,
  timeout_unit: 'day',
  ...overrides,
})

const renderPanel = (data = createData()) =>
  renderNodePanel(
    (props) => (
      <NuqsTestingAdapter>
        <Panel {...props} />
      </NuqsTestingAdapter>
    ),
    data,
    {
      hooksStoreProps: { doSyncWorkflowDraft: async () => null },
    },
  )

describe('human-input/panel HITL gate', () => {
  it('keeps legacy delivery editing live while the HITL migration gate is off', async () => {
    hitlIm.enabled = false
    const user = userEvent.setup()
    const { data } = renderPanel()

    expect(
      screen.queryByText('workflow.nodes.humanInputMigration.oldVersion'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch'))

    expect(data().delivery_methods).toEqual([
      { id: 'dm-webapp', type: DeliveryMethodType.WebApp, enabled: false },
    ])
  })
})
