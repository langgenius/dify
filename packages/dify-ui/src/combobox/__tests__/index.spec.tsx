import * as React from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxClear,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxInputTrigger,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxLabel,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
  createComboboxItems,
} from '../index'

type ResourceOption = {
  id: string
  label: string
}

const resourceOptions: ResourceOption[] = [
  { id: 'workflow', label: 'Workflow' },
  { id: 'dataset', label: 'Dataset' },
]
const resourceItems = createComboboxItems(resourceOptions, {
  getValue: (item) => item.id,
  getLabel: (item) => item.label,
})

function ComboboxTypeExamples() {
  return (
    <React.Fragment>
      <Combobox<string, true, ResourceOption>
        multiple
        items={resourceItems}
        value={['workflow']}
        filter={(item, query) => item.label.includes(query)}
        onValueChange={(value) => {
          const selectedIds: string[] = value
          void selectedIds
        }}
      >
        <ComboboxValue<string, true>>{(value) => value?.join(', ') ?? ''}</ComboboxValue>
        <ComboboxList<ResourceOption>>
          {(item) => <ComboboxItem<string> value={item.id}>{item.label}</ComboboxItem>}
        </ComboboxList>
        <ComboboxGroup<ResourceOption> items={resourceOptions}>
          <ComboboxCollection<ResourceOption>>
            {(item) => <ComboboxItem<string> value={item.id}>{item.label}</ComboboxItem>}
          </ComboboxCollection>
        </ComboboxGroup>
        {/* @ts-expect-error item anatomy accepts the derived string value, not the source object */}
        <ComboboxItem<string> value={resourceOptions[0]} />
      </Combobox>
      {/* @ts-expect-error root value uses the derived string domain, not the source object */}
      <Combobox<string, false, ResourceOption> items={resourceItems} value={resourceOptions[0]} />
    </React.Fragment>
  )
}

void ComboboxTypeExamples

const renderWithSafeViewport = (ui: React.ReactNode) =>
  render(<div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>{ui}</div>)

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

const renderSelectLikeCombobox = ({
  children,
  open = false,
}: {
  children?: React.ReactNode
  open?: boolean
} = {}) =>
  renderWithSafeViewport(
    <Combobox open={open} defaultValue="workflow" items={['workflow', 'dataset']}>
      {children ?? (
        <React.Fragment>
          <ComboboxLabel data-testid="label">Resource type</ComboboxLabel>
          <ComboboxTrigger data-testid="trigger">
            <ComboboxValue placeholder="Select resource" />
          </ComboboxTrigger>
          <ComboboxPortal>
            <ComboboxPositioner data-testid="combobox-positioner">
              <ComboboxPopup aria-label="Choose a resource" data-testid="combobox-popup">
                <ComboboxInput aria-label="Filter resources" />
                <ComboboxStatus data-testid="status">2 options</ComboboxStatus>
                <ComboboxList data-testid="list">
                  <ComboboxItem value="workflow">
                    <ComboboxItemText>Workflow</ComboboxItemText>
                    <ComboboxItemIndicator />
                  </ComboboxItem>
                  <ComboboxItem value="dataset">
                    <ComboboxItemText>Dataset</ComboboxItemText>
                  </ComboboxItem>
                </ComboboxList>
                <ComboboxEmpty data-testid="empty">No options</ComboboxEmpty>
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxPortal>
        </React.Fragment>
      )}
    </Combobox>,
  )

const renderInputCombobox = ({
  children,
  open = false,
}: {
  children?: React.ReactNode
  open?: boolean
} = {}) =>
  renderWithSafeViewport(
    <Combobox open={open} defaultValue="workflow" items={['workflow', 'dataset']}>
      {children ?? (
        <React.Fragment>
          <ComboboxInputGroup data-testid="input-group">
            <ComboboxInput aria-label="Search resources" data-testid="input" />
            <ComboboxClear data-testid="clear" />
            <ComboboxInputTrigger data-testid="input-trigger" />
          </ComboboxInputGroup>
          <ComboboxPortal>
            <ComboboxPositioner>
              <ComboboxPopup data-testid="combobox-popup">
                <ComboboxList>
                  <ComboboxItem value="workflow">
                    <ComboboxItemText>Workflow</ComboboxItemText>
                    <ComboboxItemIndicator />
                  </ComboboxItem>
                </ComboboxList>
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxPortal>
        </React.Fragment>
      )}
    </Combobox>,
  )

describe('Combobox wrappers', () => {
  describe('Select-like trigger', () => {
    it('should render label and trigger with combobox semantics', async () => {
      const screen = await renderSelectLikeCombobox()

      await expect.element(screen.getByText('Resource type')).toBeInTheDocument()
      await expect
        .element(screen.getByRole('combobox', { name: 'Resource type' }))
        .toBeInTheDocument()
    })

    it('should expose readonly styling state while allowing options to be inspected', async () => {
      const screen = await render(
        <Combobox readOnly defaultValue="workflow" items={['workflow', 'dataset']}>
          <ComboboxTrigger aria-label="Resource type">
            <ComboboxValue />
          </ComboboxTrigger>
          <ComboboxPortal>
            <ComboboxPositioner>
              <ComboboxPopup aria-label="Resource type">
                <ComboboxList>
                  <ComboboxItem value="workflow">Workflow</ComboboxItem>
                  <ComboboxItem value="dataset">Dataset</ComboboxItem>
                </ComboboxList>
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxPortal>
        </Combobox>,
      )
      const trigger = screen.getByRole('combobox', { name: 'Resource type' })

      await expect.element(trigger).toHaveAttribute('data-readonly')
      await trigger.click()
      await expect.element(screen.getByRole('option', { name: 'Dataset' })).toBeVisible()
      await screen.getByRole('option', { name: 'Dataset' }).click()
      await expect.element(trigger).toHaveTextContent('workflow')
    })
  })

  describe('Input group and controls', () => {
    it('should show the compound focus surface when keyboard users enter without Field', async () => {
      const screen = await renderInputCombobox()
      const inputGroup = screen.getByTestId('input-group')
      const input = screen.getByTestId('input')
      const restingBoxShadow = getComputedStyle(inputGroup.element()).boxShadow

      await userEvent.keyboard('{Tab}')

      await expect.element(input).toHaveFocus()
      await expect
        .poll(() => getComputedStyle(inputGroup.element()).boxShadow)
        .not.toBe(restingBoxShadow)
    })

    it('should disable autocomplete and expose placeholder and required state', async () => {
      const screen = await renderInputCombobox({
        children: (
          <ComboboxInputGroup>
            <ComboboxInput
              aria-label="Search resources"

              placeholder="Find a resource"
              required
            />
          </ComboboxInputGroup>
        ),
      })

      await expect
        .element(screen.getByRole('combobox', { name: 'Search resources' }))
        .toHaveAttribute('autocomplete', 'off')
      await expect
        .element(screen.getByRole('combobox', { name: 'Search resources' }))
        .toHaveAttribute('placeholder', 'Find a resource')
      await expect
        .element(screen.getByRole('combobox', { name: 'Search resources' }))
        .toBeRequired()
    })

    it('should not inject input-only attributes into a custom textarea', async () => {
      const screen = await renderInputCombobox({
        children: (
          <ComboboxInputGroup>
            <ComboboxInput aria-label="Search resources" render={<textarea />} />
          </ComboboxInputGroup>
        ),
      })

      await expect.element(screen.getByLabelText('Search resources')).not.toHaveAttribute('type')
    })

    it('should provide fallback aria labels and decorative icons for input controls', async () => {
      const screen = await renderInputCombobox()

      await expect
        .element(screen.getByRole('button', { name: 'Clear combobox' }))
        .toHaveAttribute('type', 'button')
      await expect
        .element(screen.getByRole('button', { name: 'Open combobox options' }))
        .toHaveAttribute('type', 'button')
    })

    it('should rely on aria-labelledby when provided instead of injecting fallback labels', async () => {
      const screen = await renderInputCombobox({
        children: (
          <React.Fragment>
            <span id="clear-label">Clear from label</span>
            <span id="trigger-label">Trigger from label</span>
            <ComboboxInputGroup>
              <ComboboxInput aria-label="Search resources" />
              <ComboboxClear aria-labelledby="clear-label" />
              <ComboboxInputTrigger aria-labelledby="trigger-label" />
            </ComboboxInputGroup>
          </React.Fragment>
        ),
      })

      await expect
        .element(screen.getByRole('button', { name: 'Clear from label' }))
        .not.toHaveAttribute('aria-label')
      await expect
        .element(screen.getByRole('button', { name: 'Trigger from label' }))
        .not.toHaveAttribute('aria-label')
    })
  })

  describe('Popup anatomy and options', () => {
    it('should keep the popup input visible and scroll the list in a short viewport', async () => {
      const popupRef = React.createRef<HTMLDivElement>()
      const longOptions = Array.from({ length: 30 }, (_, index) => `Resource ${index + 1}`)
      const originalViewport = {
        height: window.innerHeight,
        width: window.innerWidth,
      }

      await page.viewport(800, 360)

      try {
        const screen = await render(
          <div style={{ padding: 16 }}>
            <Combobox open items={longOptions}>
              <ComboboxTrigger aria-label="Resource">Choose resource</ComboboxTrigger>
              <ComboboxPortal>
                <ComboboxPositioner>
                  <ComboboxPopup ref={popupRef} aria-label="Choose a resource">
                    <ComboboxInput aria-label="Filter resources" />
                    <ComboboxList<string>>
                      {(item) => (
                        <ComboboxItem key={item} value={item}>
                          {item}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxPopup>
                </ComboboxPositioner>
              </ComboboxPortal>
            </Combobox>
          </div>,
        )

        const input = screen.getByRole('combobox', { name: 'Filter resources' })
        const list = screen.getByRole('listbox')
        await expect.element(list).toBeVisible()
        await vi.waitFor(() => {
          const popupBounds = popupRef.current!.getBoundingClientRect()
          const inputBounds = input.element().getBoundingClientRect()

          expect(window.innerHeight).toBe(360)
          expect(popupBounds.top).toBeGreaterThanOrEqual(0)
          expect(popupBounds.bottom).toBeLessThanOrEqual(window.innerHeight)
          expect(inputBounds.top).toBeGreaterThanOrEqual(popupBounds.top)
          expect(inputBounds.bottom).toBeLessThanOrEqual(popupBounds.bottom)
          expect(list.element().scrollHeight).toBeGreaterThan(list.element().clientHeight)
          expect(popupRef.current!.scrollHeight).toBeLessThanOrEqual(popupRef.current!.clientHeight)
        })
      } finally {
        await page.viewport(originalViewport.width, originalViewport.height)
      }
    })

    it('should render source objects while exposing primitive selected values', async () => {
      const onValueChange = vi.fn()
      const screen = await render(
        <Combobox<string, false, ResourceOption>
          defaultOpen
          items={resourceItems}
          defaultValue="workflow"
          filter={(item, query) => item.label.toLowerCase().includes(query.toLowerCase())}
          onValueChange={(nextValue) => onValueChange(nextValue)}
        >
          <ComboboxInput aria-label="Filter resources" />
          <ComboboxList<ResourceOption>>
            {(item) => (
              <ComboboxItem<string> key={item.id} value={item.id}>
                {item.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </Combobox>,
      )

      await expect
        .element(screen.getByRole('option', { name: 'Workflow' }))
        .toHaveAttribute('aria-selected', 'true')
      await userEvent.click(screen.getByRole('option', { name: 'Dataset' }))

      expect(onValueChange).toHaveBeenCalledWith('dataset')
    })

    it('should use default overlay placement', async () => {
      const screen = await renderSelectLikeCombobox({ open: true })

      await expect
        .element(screen.getByTestId('combobox-positioner'))
        .toHaveAttribute('data-side', 'bottom')
      await expect
        .element(screen.getByTestId('combobox-positioner'))
        .toHaveAttribute('data-align', 'start')
      await expect
        .element(screen.getByRole('dialog', { name: 'Choose a resource' }))
        .toBeInTheDocument()
    })

    it('should apply custom placement side and passthrough popup props', async () => {
      const onPopupClick = vi.fn()
      const screen = await renderWithSafeViewport(
        <Combobox open defaultValue="workflow" items={['workflow']}>
          <ComboboxTrigger aria-label="Resource type">
            <ComboboxValue />
          </ComboboxTrigger>
          <ComboboxPortal>
            <ComboboxPositioner
              placement="top-end"
              sideOffset={12}
              alignOffset={6}
              data-testid="combobox-positioner"
            >
              <ComboboxPopup
                aria-label="Choose a resource"
                data-testid="combobox-popup"
                onClick={onPopupClick}
              >
                <ComboboxInput aria-label="Filter resources" />
                <ComboboxList>
                  <ComboboxItem value="workflow">
                    <ComboboxItemText>Workflow</ComboboxItemText>
                  </ComboboxItem>
                </ComboboxList>
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxPortal>
        </Combobox>,
      )

      await screen.getByTestId('combobox-popup').click()

      await expect
        .element(screen.getByTestId('combobox-positioner'))
        .toHaveAttribute('data-side', 'top')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
    })

    it('names the dialog popup when the input is composed inside it', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox open items={['workflow']}>
          <ComboboxLabel>Resource type</ComboboxLabel>
          <ComboboxTrigger>Choose resource</ComboboxTrigger>
          <ComboboxPortal>
            <ComboboxPositioner>
              <ComboboxPopup aria-label="Choose a resource">
                <ComboboxInput aria-label="Filter resources" />
                <ComboboxList>
                  <ComboboxItem value="workflow">Workflow</ComboboxItem>
                </ComboboxList>
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxPortal>
        </Combobox>,
      )

      await expect
        .element(screen.getByRole('dialog', { name: 'Choose a resource' }))
        .toBeInTheDocument()
      await expect
        .element(screen.getByRole('combobox', { name: 'Filter resources' }))
        .toBeInTheDocument()
    })

    it('keeps an empty live region mounted without visible spacing', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox items={[]}>
          <ComboboxInput aria-label="Search resources" />
          <ComboboxStatus>{null}</ComboboxStatus>
        </Combobox>,
      )

      const status = screen.getByRole('status')

      expect(status.element().getBoundingClientRect().height).toBe(0)
    })

    it('should navigate function-rendered items with arrow keys', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox defaultValue="workflow" items={['workflow', 'dataset', 'app']}>
          <ComboboxInputGroup>
            <ComboboxInput aria-label="Search resources" />
          </ComboboxInputGroup>
          <ComboboxPortal>
            <ComboboxPositioner>
              <ComboboxPopup>
                <ComboboxList<string>>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      <ComboboxItemText>{item}</ComboboxItemText>
                      <ComboboxItemIndicator />
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxPortal>
        </Combobox>,
      )

      const input = asHTMLElement(
        screen.getByRole('combobox', { name: 'Search resources' }).element(),
      )

      input.focus()
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
      await expect
        .element(screen.getByRole('option', { name: 'workflow' }))
        .toHaveAttribute('data-highlighted')

      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )

      await expect
        .element(screen.getByRole('option', { name: 'dataset' }))
        .toHaveAttribute('data-highlighted')
    })
  })

  describe('Multiple selection chips', () => {
    it('should show the compound focus surface for a nested input without Field', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox multiple items={['maya', 'nora']}>
          <ComboboxInputGroup data-testid="input-group">
            <ComboboxChips>
              <ComboboxInput aria-label="Reviewers" data-testid="input" />
            </ComboboxChips>
          </ComboboxInputGroup>
        </Combobox>,
      )
      const inputGroup = screen.getByTestId('input-group')
      const input = screen.getByTestId('input')
      const restingBoxShadow = getComputedStyle(inputGroup.element()).boxShadow

      await userEvent.keyboard('{Tab}')

      await expect.element(input).toHaveFocus()
      await expect
        .poll(() => getComputedStyle(inputGroup.element()).boxShadow)
        .not.toBe(restingBoxShadow)
    })

    it('should expose a controlled null value to a typed multiple value renderer', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox<string, true> multiple value={null}>
          <ComboboxInputGroup>
            <ComboboxValue<string, true>>
              {(selectedValue) =>
                selectedValue === null ? 'No reviewers selected' : selectedValue.join(', ')
              }
            </ComboboxValue>
            <ComboboxInput aria-label="Reviewers" />
          </ComboboxInputGroup>
        </Combobox>,
      )

      await expect.element(screen.getByText('No reviewers selected')).toBeInTheDocument()
    })

    it('should give chip remove buttons a default accessible name and non-submit type', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox multiple defaultValue={['maya']} items={['maya', 'nora']}>
          <ComboboxInputGroup>
            <ComboboxChips data-testid="chips">
              <ComboboxValue<string, true>>
                {(selectedValue) => (
                  <React.Fragment>
                    {selectedValue?.map((item) => (
                      <ComboboxChip key={item}>
                        <span>{item}</span>
                        <ComboboxChipRemove data-testid="remove-chip" />
                      </ComboboxChip>
                    ))}
                    <ComboboxInput aria-label="Reviewers" />
                  </React.Fragment>
                )}
              </ComboboxValue>
            </ComboboxChips>
          </ComboboxInputGroup>
        </Combobox>,
      )

      await expect
        .element(screen.getByRole('button', { name: 'Remove selected item' }))
        .toHaveAttribute('type', 'button')
    })

    it('should preserve chip remove aria-labelledby over fallback label', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox multiple defaultValue={['maya']} items={['maya']}>
          <ComboboxInputGroup>
            <ComboboxChips>
              <ComboboxValue<string, true>>
                {(selectedValue) => (
                  <React.Fragment>
                    {selectedValue?.map((item) => (
                      <ComboboxChip key={item}>
                        <span id="remove-maya">Remove Maya</span>
                        <ComboboxChipRemove aria-labelledby="remove-maya" />
                      </ComboboxChip>
                    ))}
                    <ComboboxInput aria-label="Reviewers" />
                  </React.Fragment>
                )}
              </ComboboxValue>
            </ComboboxChips>
          </ComboboxInputGroup>
        </Combobox>,
      )

      await expect
        .element(screen.getByRole('button', { name: 'Remove Maya' }))
        .not.toHaveAttribute('aria-label')
    })
  })
})
