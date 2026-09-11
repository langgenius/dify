import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import GenericTable from '../generic-table'

describe('Webhook parameter table keyboard visibility', () => {
  it('reveals the delete action when keyboard focus reaches its row', async () => {
    // Chromium computes ancestor opacity and focus-within styling; DOM-only tests cannot verify visibility.
    const screen = await render(
      <>
        <button type="button">Before parameters</button>
        <GenericTable
          title="Headers"
          columns={[{ key: 'name', title: 'Name', type: 'input', width: 'flex-1' }]}
          data={[{ name: 'Authorization' }]}
          emptyRowData={{ name: '' }}
          onChange={() => {}}
        />
      </>,
    )

    const before = screen.getByRole('button', { name: 'Before parameters' })
    await before.click()
    await userEvent.tab()
    await userEvent.tab()

    const deleteButton = screen.getByRole('button', { name: 'Delete row' })
    expect(deleteButton.element()).toHaveFocus()
    let effectiveOpacity = 1
    for (
      let element: Element | null = deleteButton.element();
      element;
      element = element.parentElement
    )
      effectiveOpacity *= Number(getComputedStyle(element).opacity)
    expect(effectiveOpacity).toBe(1)
    expect(getComputedStyle(deleteButton.element()).boxShadow).not.toBe('none')
  })
})
