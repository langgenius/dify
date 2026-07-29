import type { InputVar } from '@/app/components/workflow/types'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import VarItem from '../var-item'

vi.mock('@/app/components/app/configuration/config-var/config-modal', () => ({
  __esModule: true,
  default: ({ isShow }: { isShow: boolean }) =>
    isShow ? <div role="dialog">edit-variable</div> : null,
}))

const createPayload = (overrides: Partial<InputVar> = {}): InputVar => ({
  label: 'Query',
  variable: 'query',
  type: InputVarType.textInput,
  required: false,
  ...overrides,
})

describe('StartVarItem', () => {
  it('shows named edit and remove actions on hover', () => {
    const handleRemove = vi.fn()
    const { container } = render(
      <VarItem readonly={false} payload={createPayload()} onRemove={handleRemove} />,
    )

    fireEvent.mouseEnter(container.firstElementChild!)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('edit-variable')

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(handleRemove).toHaveBeenCalledTimes(1)
  })

  describe('default value indicator', () => {
    it('renders beneath the field name, not in the required metadata zone', () => {
      render(
        <VarItem readonly={false} payload={createPayload({ required: true, default: 'hello' })} />,
      )

      const defaultLine = screen.getByTestId('var-item-default')
      const nameEl = screen.getByText('query')

      // POSITION: the default sits on its own line directly beneath the name line
      // (its previous sibling in the identity column), left-aligned under the name.
      expect(defaultLine.previousElementSibling).toContainElement(nameEl)

      // It shares the identity column with the name...
      const identityColumn = defaultLine.parentElement!
      expect(identityColumn).toContainElement(nameEl)

      // ...and is NOT in the right-hand metadata zone where `required` lives.
      const requiredEl = screen.getByText('workflow.nodes.start.required')
      expect(identityColumn).not.toContainElement(requiredEl)
    })

    it('shows nothing when no default is set', () => {
      render(<VarItem readonly={false} payload={createPayload()} />)
      expect(screen.queryByTestId('var-item-default')).toBeNull()
    })

    it('treats an empty-string default as unset (shows nothing)', () => {
      render(<VarItem readonly={false} payload={createPayload({ default: '' })} />)
      expect(screen.queryByTestId('var-item-default')).toBeNull()
    })

    it.each([
      { label: 'false', value: false as const, text: 'false' },
      { label: '0', value: 0 as const, text: '0' },
    ])('still shows a falsy-but-set default ($label)', ({ value, text }) => {
      render(<VarItem readonly={false} payload={createPayload({ default: value })} />)
      expect(screen.getByTestId('var-item-default-value')).toHaveTextContent(text)
    })

    it('shows the FULL value in a tooltip on hover and does not disappear', async () => {
      const user = userEvent.setup()
      const longDefault = `sentinel-${'x'.repeat(200)}`
      // delay={0} mirrors the app's global TooltipProvider (delay 300ms in prod) but
      // opens instantly so the test is deterministic.
      render(
        <TooltipProvider delay={0}>
          <VarItem readonly={false} payload={createPayload({ default: longDefault })} />
        </TooltipProvider>,
      )

      const trigger = screen.getByTestId('var-item-default-value')
      // Only the truncated trigger carries the value before hover.
      expect(screen.getAllByText(longDefault)).toHaveLength(1)

      await user.hover(trigger)

      // Hovering flips the row's hover state (which swaps the right-hand metadata zone
      // for the edit/remove buttons) — the default line lives OUTSIDE that zone, so the
      // tooltip trigger stays mounted and the portal tooltip shows the FULL value.
      const tooltip = await screen.findByText(longDefault, {
        selector: '[data-base-ui-portal] *',
      })
      expect(tooltip).toBeInTheDocument()
      // Trigger is still present (did not unmount on hover).
      expect(screen.getByTestId('var-item-default-value')).toBeInTheDocument()
    })
  })
})
