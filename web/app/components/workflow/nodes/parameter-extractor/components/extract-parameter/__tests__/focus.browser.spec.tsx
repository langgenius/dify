import type { Param } from '../../../types'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ParamType } from '../../../types'
import { ExtractParameterList } from '../list'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

function ParametersFixture() {
  const [parameters, setParameters] = useState<Param[]>([
    { name: 'city', type: ParamType.string, description: 'City name', required: false },
  ])
  return (
    <div className="w-96 p-4">
      <button type="button" className="mb-8">
        Before parameters
      </button>
      <ExtractParameterList readonly={false} list={parameters} onChange={setParameters} />
    </div>
  )
}

it('returns visible keyboard focus to the row action after cancel and after renaming', async () => {
  // Native focus restoration and focus-within visibility require the real browser and CSS.
  const screen = await render(<ParametersFixture />)
  await screen.getByRole('button', { name: 'Before parameters' }).click()
  await userEvent.tab()
  const edit = screen.getByRole('button', { name: 'common.operation.edit city' })
  await expect.element(edit).toHaveFocus()
  expect(edit.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(edit).toHaveFocus()
  expect(edit.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await screen
    .getByRole('textbox', {
      name: 'workflowModels.nodes.parameterExtractor.addExtractParameterContent.name',
    })
    .fill('country')
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  const renamedEdit = screen.getByRole('button', { name: 'common.operation.edit country' })
  await expect.element(renamedEdit).toHaveFocus()
  expect(renamedEdit.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.tab()
  await expect
    .element(screen.getByRole('button', { name: 'common.operation.delete country' }))
    .toHaveFocus()
})
