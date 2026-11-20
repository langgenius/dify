import type { CoachmarkInteraction } from '..'
import { useRef, useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  Coachmark,
  CoachmarkArrow,
  CoachmarkClose,
  CoachmarkPopup,
  CoachmarkPortal,
  CoachmarkPositioner,
  CoachmarkSpotlight,
  CoachmarkTitle,
} from '..'

type DemoProps = {
  interaction?: CoachmarkInteraction
  onOpenChange?: () => void
}

function Demo({ interaction, onOpenChange }: DemoProps) {
  const [target, setTarget] = useState<HTMLButtonElement | null>(null)
  const actionRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button type="button" style={{ margin: 16 }}>
        Outside
      </button>
      <button ref={setTarget} type="button" style={{ margin: 16 }}>
        Target
      </button>
      <Coachmark target={target} interaction={interaction} onOpenChange={onOpenChange}>
        <CoachmarkPortal>
          <CoachmarkSpotlight />
          <CoachmarkPositioner>
            <CoachmarkPopup initialFocus={actionRef}>
              <CoachmarkArrow />
              <CoachmarkTitle>Start here</CoachmarkTitle>
              <CoachmarkClose>Skip</CoachmarkClose>
              <button ref={actionRef} type="button">
                Next
              </button>
            </CoachmarkPopup>
          </CoachmarkPositioner>
        </CoachmarkPortal>
      </Coachmark>
    </>
  )
}

it('opens below the target and focuses the initial focus element', async () => {
  const screen = await render(<Demo />)

  const coachmark = screen.getByRole('dialog', { name: 'Start here' })
  await expect.element(coachmark).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
  const targetRect = screen.getByText('Target').element().getBoundingClientRect()
  expect(coachmark.element().getBoundingClientRect().top).toBeGreaterThan(targetRect.bottom)
})

it('reports Escape and the close part through onOpenChange', async () => {
  const onOpenChange = vi.fn()
  const screen = await render(<Demo onOpenChange={onOpenChange} />)

  await expect.element(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(onOpenChange).toHaveBeenLastCalledWith(
    false,
    expect.objectContaining({ reason: 'escape-key' }),
  )

  await screen.getByRole('button', { name: 'Skip' }).click()
  expect(onOpenChange).toHaveBeenLastCalledWith(
    false,
    expect.objectContaining({ reason: 'close-press' }),
  )
})

it('blocks the page but lets the target through in target-only mode', async () => {
  const screen = await render(<Demo interaction="target-only" />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()

  const target = screen.getByRole('button', { name: 'Target' }).element()
  const outside = screen.getByRole('button', { name: 'Outside' }).element()
  const pointAt = (element: Element) => {
    const rect = element.getBoundingClientRect()
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }
  expect(pointAt(target)).toBe(target)
  expect(pointAt(outside)).not.toBe(outside)
})

it('moves Tab from the close part into the target in target-only mode', async () => {
  const screen = await render(<Demo interaction="target-only" />)
  await expect.element(screen.getByRole('button', { name: 'Next' })).toHaveFocus()

  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(screen.getByRole('button', { name: 'Skip' })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('button', { name: 'Target' })).toHaveFocus()
})

it('leaves the page interactive when unblocked', async () => {
  const screen = await render(<Demo interaction="unblocked" />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()

  const outside = screen.getByRole('button', { name: 'Outside' }).element()
  const rect = outside.getBoundingClientRect()
  expect(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)).toBe(
    outside,
  )
})
