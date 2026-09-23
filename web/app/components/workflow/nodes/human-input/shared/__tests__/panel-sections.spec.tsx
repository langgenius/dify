import type { HumanInputSharedPanelConfig } from '../panel-sections'
import type { HumanInputSharedNodeType, UserAction } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import HumanInputSharedPanelSections from '../panel-sections'
import { UserActionButtonType } from '../types'

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { nodePanelWidth: number }) => unknown) =>
    selector({ nodePanelWidth: 400 }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))

// Keep the action list and its inputs real; the rich form editor is unrelated to action editing.
vi.mock('../../components/form-content', () => ({ default: () => null }))
vi.mock('../../components/form-content-preview', () => ({ default: () => null }))

const initialActions: UserAction[] = [
  { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
  { id: 'defer', title: 'Defer', button_style: UserActionButtonType.Accent },
  { id: 'reject', title: 'Reject', button_style: UserActionButtonType.Default },
]

const ActionPanel = () => {
  const [actions, setActions] = useState(initialActions)
  const config: HumanInputSharedPanelConfig<HumanInputSharedNodeType> = {
    inputs: {
      title: 'Human Input',
      desc: '',
      type: BlockEnum.HumanInput,
      form_content: '',
      inputs: [],
      user_actions: actions,
      timeout: 1,
      timeout_unit: 'hour',
    },
    readOnly: false,
    editorKey: 0,
    structuredOutputCollapsed: true,
    setStructuredOutputCollapsed: vi.fn(),
    handleUserActionAdd: (action) => setActions((current) => [...current, action]),
    handleUserActionChange: (index, action) =>
      setActions((current) =>
        current.map((item, itemIndex) => (itemIndex === index ? action : item)),
      ),
    handleUserActionDelete: (id) =>
      setActions((current) => current.filter((action) => action.id !== id)),
    handleTimeoutChange: vi.fn(),
    handleFormContentChange: vi.fn(),
    handleFormInputsChange: vi.fn(),
    handleFormInputItemRename: vi.fn(),
    handleFormInputItemRemove: vi.fn(),
  }

  return <HumanInputSharedPanelSections id="human-input" config={config} />
}

const getActionIds = () =>
  screen.getAllByRole('textbox', {
    name: 'workflow.nodes.humanInput.userActions.actionNamePlaceholder',
  })
const getActionTitles = () =>
  screen.getAllByRole('textbox', {
    name: 'workflow.nodes.humanInput.userActions.buttonTextPlaceholder',
  })

describe('HumanInputSharedPanelSections action editing', () => {
  it('keeps focus while typing an action ID across controlled updates', async () => {
    const user = userEvent.setup()
    render(<ActionPanel />)

    const input = screen.getByDisplayValue('approve')
    await user.click(input)
    await user.keyboard('{End}_review')

    expect(getActionIds()[0]).toHaveValue('approve_review')
    expect(input).toHaveFocus()
    expect(getActionTitles()[0]).toHaveValue('Approve')
    expect(getActionIds()[1]).toHaveValue('defer')
  })

  it('keeps focus when clearing an action ID and typing its replacement', async () => {
    const user = userEvent.setup()
    render(<ActionPanel />)

    const input = screen.getByDisplayValue('approve')
    await user.clear(input)
    expect(input).toHaveFocus()
    await user.keyboard('confirm')

    expect(getActionIds()[0]).toHaveValue('confirm')
    expect(input).toHaveFocus()
  })

  it('edits the correct remaining action after deleting the middle row', async () => {
    const user = userEvent.setup()
    render(<ActionPanel />)

    await user.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[1]!)
    expect(getActionIds()).toHaveLength(2)
    expect(getActionIds()[1]).toHaveValue('reject')
    expect(getActionTitles()[1]).toHaveValue('Reject')

    await user.click(screen.getByDisplayValue('reject'))
    await user.keyboard('{End}_review')
    await user.clear(screen.getByDisplayValue('Reject'))
    await user.keyboard('Request changes')

    expect(getActionIds()[1]).toHaveValue('reject_review')
    expect(getActionTitles()[1]).toHaveValue('Request changes')
    expect(getActionIds()[0]).toHaveValue('approve')
    expect(getActionTitles()[0]).toHaveValue('Approve')
  })
})
