import { render } from 'vitest-browser-react'
import { CollaboratorCursor } from '../collaborator-cursor'

it.each([
  ['ltr', 'Bob'],
  ['rtl', 'Bob'],
  ['rtl', 'سارة'],
] as const)('puts the pointer tip on its position in %s for %s', async (direction, name) => {
  const screen = await render(
    <div dir={direction} style={{ position: 'relative', width: 400, height: 200 }}>
      <CollaboratorCursor
        name={name}
        color="#155AEF"
        className="absolute"
        style={{ left: 100, top: 50 }}
      />
    </div>,
  )
  const tag = screen.getByText(name)
  await expect.element(tag).toBeVisible()

  const labelElement = tag.element().parentElement!
  const cursor = labelElement.parentElement!
  const container = cursor.parentElement!.getBoundingClientRect()
  const pointer = cursor.querySelector('span')!.getBoundingClientRect()
  const label = labelElement.getBoundingClientRect()

  // The 24px pointer's tip is at (7, 3); the tag sits at (13.5, 17.5) from the tip.
  expect(pointer.left - container.left).toBe(100 - 7)
  expect(pointer.top - container.top).toBe(50 - 3)
  expect(pointer.width).toBe(24)
  expect(label.left - container.left).toBeCloseTo(100 + 13.5, 1)
  expect(label.top - container.top).toBeCloseTo(50 + 17.5, 1)
})
