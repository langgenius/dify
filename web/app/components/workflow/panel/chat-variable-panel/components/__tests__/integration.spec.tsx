/* eslint-disable ts/no-explicit-any */
import type { ConversationVariable } from '@/app/components/workflow/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import ArrayBoolList from '../array-bool-list'
import ArrayValueList from '../array-value-list'
import VariableItem from '../variable-item'
import VariableModalTrigger from '../variable-modal-trigger'
import VariableTypeSelector from '../variable-type-select'

vi.mock('../variable-modal', () => ({
  default: ({ chatVar, onSave, onClose }: any) => (
    <div>
      {chatVar?.name && <div>{chatVar.name}</div>}
      <button type="button" onClick={() => onSave({ id: 'saved' })}>save-modal</button>
      <button type="button" onClick={onClose}>close-modal</button>
    </div>
  ),
}))

const createVariable = (overrides: Partial<ConversationVariable> = {}): ConversationVariable => ({
  id: 'var-1',
  name: 'conversation_var',
  description: 'Conversation scoped variable',
  value_type: ChatVarType.String,
  value: '',
  ...overrides,
})

describe('chat-variable-panel components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The panel leaf components should support editing, selecting types, and opening the add-variable modal.
  describe('Leaf interactions', () => {
    it('should update string array items, add rows, and remove rows', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <ArrayValueList
          isString
          list={['alpha', 'beta']}
          onChange={onChange}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('alpha'), { target: { value: 'updated' } })
      await user.click(screen.getByText('workflow.chatVariable.modal.addArrayValue'))
      await user.click(screen.getAllByRole('button')[0]!)

      expect(onChange).toHaveBeenCalledTimes(3)
    })

    it('should coerce number array items and append undefined rows', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <ArrayValueList
          isString={false}
          list={[1]}
          onChange={onChange}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '7' } })
      await user.click(screen.getByText('workflow.chatVariable.modal.addArrayValue'))

      expect(onChange).toHaveBeenNthCalledWith(1, [7])
      expect(onChange).toHaveBeenNthCalledWith(2, [1, undefined])
    })

    it('should call edit and delete handlers from the variable item actions', async () => {
      const user = userEvent.setup()
      const onEdit = vi.fn()
      const onDelete = vi.fn()
      const { container } = render(
        <VariableItem
          item={createVariable()}
          onEdit={onEdit}
          onDelete={onDelete}
        />,
      )

      const card = container.firstElementChild as HTMLDivElement
      const actions = container.querySelectorAll('.cursor-pointer')
      fireEvent.mouseOver(actions[1] as Element)
      expect(card.className).toContain('border-state-destructive-border')
      fireEvent.mouseOut(actions[1] as Element)
      expect(card.className).not.toContain('border-state-destructive-border')

      const icons = container.querySelectorAll('svg')
      await user.click(icons[1] as SVGElement)
      await user.click(icons[2] as SVGElement)

      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'var-1' }))
      expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'var-1' }))
    })

    it('should toggle the type selector and select a new value', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(
        <VariableTypeSelector
          value="string"
          list={['string', 'number', 'boolean']}
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByText('string'))
      await user.click(screen.getByText('number'))

      expect(onSelect).toHaveBeenCalledWith('number')
    })

    it('should dismiss the type selector through the real portal close flow', async () => {
      const user = userEvent.setup()

      render(
        <VariableTypeSelector
          value="string"
          list={['string', 'number']}
          onSelect={vi.fn()}
        />,
      )

      await user.click(screen.getByText('string'))
      expect(screen.getByText('number')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByText('number')).not.toBeInTheDocument()
      })
    })

    it('should open the in-cell selector from its trigger and keep the popup class', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(
        <VariableTypeSelector
          inCell
          value="string"
          list={['string', 'number']}
          popupClassName="custom-popup"
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getAllByText('string')[0]!)

      expect(screen.getByText('number').closest('.custom-popup')).not.toBeNull()
      await user.click(screen.getAllByText('string')[1]!)
      expect(onSelect).toHaveBeenCalledWith('string')
    })

    it('should update, add, and remove boolean array values', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { container } = render(
        <ArrayBoolList
          list={[true]}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('False'))
      expect(onChange).toHaveBeenNthCalledWith(1, [false])

      await user.click(screen.getByText('workflow.chatVariable.modal.addArrayValue'))
      expect(onChange).toHaveBeenNthCalledWith(2, [true, false])

      const buttons = container.querySelectorAll('button')
      await user.click(buttons[0] as HTMLButtonElement)
      expect(onChange).toHaveBeenNthCalledWith(3, [])
    })

    it('should toggle the modal trigger without closing when it starts closed', async () => {
      const user = userEvent.setup()
      const setOpen = vi.fn()
      const onClose = vi.fn()
      render(
        <VariableModalTrigger
          open={false}
          setOpen={setOpen}
          showTip
          onClose={onClose}
          onSave={vi.fn()}
        />,
      )

      expect(screen.queryByText('save-modal')).not.toBeInTheDocument()

      await user.click(screen.getByText('workflow.chatVariable.button'))

      expect(setOpen).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should open the modal trigger and close after saving', async () => {
      const user = userEvent.setup()
      const setOpen = vi.fn()
      const onClose = vi.fn()
      const onSave = vi.fn()
      render(
        <VariableModalTrigger
          open
          setOpen={setOpen}
          showTip={false}
          chatVar={createVariable()}
          onClose={onClose}
          onSave={onSave}
        />,
      )

      expect(screen.getByText('conversation_var')).toBeInTheDocument()

      await user.click(screen.getByText('save-modal'))
      await user.click(screen.getByText('close-modal'))

      expect(onSave).toHaveBeenCalledWith({ id: 'saved' })
      expect(onClose).toHaveBeenCalled()
      expect(setOpen).toHaveBeenCalledWith(false)
    })

    it('should close the modal trigger when clicking the trigger while already open', async () => {
      const user = userEvent.setup()
      const setOpen = vi.fn()
      const onClose = vi.fn()

      render(
        <VariableModalTrigger
          open
          setOpen={setOpen}
          showTip={false}
          chatVar={createVariable()}
          onClose={onClose}
          onSave={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'workflow.chatVariable.button' }))

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(setOpen).toHaveBeenCalled()
    })

    it('should close the modal trigger when the portal dismisses', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      const TriggerHarness = () => {
        const [open, setOpen] = React.useState(true)

        return (
          <VariableModalTrigger
            open={open}
            setOpen={setOpen}
            showTip={false}
            chatVar={createVariable()}
            onClose={onClose}
            onSave={vi.fn()}
          />
        )
      }

      render(<TriggerHarness />)

      expect(screen.getByText('save-modal')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByText('save-modal')).not.toBeInTheDocument()
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
