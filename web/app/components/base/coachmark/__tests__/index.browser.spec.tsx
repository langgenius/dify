import type { CoachmarkModal, CoachmarkProps } from '..'
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

type Step = 'first' | 'second'

type DemoProps = Pick<CoachmarkProps, 'highlightSelectors' | 'onOpenChange' | 'open'> & {
  modal?: CoachmarkModal
  step?: Step
  secondTargetMounted?: boolean
  onNext?: () => void
}

function Demo({
  modal,
  open,
  onOpenChange,
  highlightSelectors,
  step = 'first',
  secondTargetMounted = true,
  onNext,
}: DemoProps) {
  const [targets, setTargets] = useState<Partial<Record<Step, HTMLElement | null>>>({})
  const [targetRefs] = useState(() => ({
    first: (element: HTMLElement | null) =>
      setTargets((current) => ({ ...current, first: element })),
    second: (element: HTMLElement | null) =>
      setTargets((current) => ({ ...current, second: element })),
  }))
  const actionRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button type="button" style={{ margin: 16 }}>
        Outside
      </button>
      <button ref={targetRefs.first} type="button" style={{ margin: 16 }}>
        First target
      </button>
      {secondTargetMounted && (
        <button
          ref={targetRefs.second}
          type="button"
          style={{ margin: 16, marginInlineStart: 200 }}
        >
          Second target
        </button>
      )}
      <Coachmark
        open={open}
        defaultOpen
        onOpenChange={onOpenChange}
        target={targets[step] ?? null}
        highlightSelectors={highlightSelectors}
        modal={modal}
      >
        <CoachmarkPortal>
          <CoachmarkSpotlight data-testid="spotlight" />
          <CoachmarkPositioner>
            <CoachmarkPopup initialFocus={actionRef}>
              <CoachmarkArrow />
              <CoachmarkTitle>{step === 'first' ? 'Start here' : 'Then here'}</CoachmarkTitle>
              <CoachmarkClose>Skip</CoachmarkClose>
              <button ref={actionRef} type="button" onClick={onNext}>
                Next
              </button>
            </CoachmarkPopup>
          </CoachmarkPositioner>
        </CoachmarkPortal>
      </Coachmark>
    </>
  )
}

const pointAt = (element: Element) => {
  const rect = element.getBoundingClientRect()
  return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
}

it('opens below the target and focuses the initial focus element', async () => {
  const screen = await render(<Demo />)

  const coachmark = screen.getByRole('dialog', { name: 'Start here' })
  await expect.element(coachmark).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
  const targetRect = screen.getByText('First target').element().getBoundingClientRect()
  expect(coachmark.element().getBoundingClientRect().top).toBeGreaterThan(targetRect.bottom)
})

it('reports only Escape and the close part, and stays open until the owner closes it', async () => {
  const onOpenChange = vi.fn()
  const screen = await render(<Demo open onOpenChange={onOpenChange} />)
  const coachmark = screen.getByRole('dialog', { name: 'Start here' })
  await expect.element(screen.getByRole('button', { name: 'Next' })).toHaveFocus()

  await userEvent.keyboard('{Escape}')
  expect(onOpenChange).toHaveBeenLastCalledWith(
    false,
    expect.objectContaining({ reason: 'escape-key' }),
  )
  await expect.element(coachmark).toBeVisible()

  await screen.getByRole('button', { name: 'Skip' }).click()
  expect(onOpenChange).toHaveBeenLastCalledWith(
    false,
    expect.objectContaining({ reason: 'close-press' }),
  )
  expect(onOpenChange).toHaveBeenCalledTimes(2)

  await screen.rerender(<Demo open={false} onOpenChange={onOpenChange} />)
  await expect.element(coachmark).not.toBeInTheDocument()
  await screen.rerender(<Demo open onOpenChange={onOpenChange} />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()
})

it('closes on its own when uncontrolled', async () => {
  const screen = await render(<Demo />)
  const coachmark = screen.getByRole('dialog', { name: 'Start here' })
  await expect.element(coachmark).toBeVisible()

  await screen.getByRole('button', { name: 'Skip' }).click()
  await expect.element(coachmark).not.toBeInTheDocument()
})

it('blocks the page but lets the target through when modal allows the target', async () => {
  const screen = await render(<Demo modal="allow-target" />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()

  const target = screen.getByRole('button', { name: 'First target' }).element()
  const outside = screen.getByRole('button', { name: 'Outside' }).element()
  expect(pointAt(target)).toBe(target)
  expect(pointAt(outside)).not.toBe(outside)
})

it('keeps Tab between the popup and the target when modal allows the target', async () => {
  const screen = await render(<Demo modal="allow-target" />)
  const next = screen.getByRole('button', { name: 'Next' })
  const target = screen.getByRole('button', { name: 'First target' })
  await expect.element(next).toHaveFocus()

  await userEvent.keyboard('{Tab}')
  await expect.element(target).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('button', { name: 'Skip' })).toHaveFocus()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(target).toHaveFocus()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(next).toHaveFocus()
})

it('leaves the page interactive when not modal', async () => {
  const screen = await render(<Demo modal={false} />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()

  const outside = screen.getByRole('button', { name: 'Outside' }).element()
  expect(pointAt(outside)).toBe(outside)
})

it('keeps the shown step while the next target is pending, then glides to it', async () => {
  const onNext = vi.fn()
  const screen = await render(<Demo onNext={onNext} secondTargetMounted={false} />)
  const coachmark = screen.getByRole('dialog', { name: 'Start here' })
  await expect.element(coachmark).toBeVisible()

  await screen.rerender(<Demo onNext={onNext} step="second" secondTargetMounted={false} />)
  await expect.element(coachmark).toHaveAttribute('data-pending')
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()
  await screen.getByRole('button', { name: 'Next' }).click()
  expect(onNext).not.toHaveBeenCalled()

  await screen.rerender(<Demo onNext={onNext} step="second" />)
  const second = screen.getByRole('dialog', { name: 'Then here' })
  await expect.element(second).toBeVisible()
  await expect.element(screen.getByTestId('spotlight')).toHaveAttribute('data-gliding')
  await expect.element(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
  const targetRect = screen.getByText('Second target').element().getBoundingClientRect()
  await expect
    .poll(() => screen.getByTestId('spotlight').element().getBoundingClientRect().left)
    .toBe(targetRect.left - 4)
  expect(second.element().getBoundingClientRect().top).toBeGreaterThan(targetRect.bottom)
})

it('waits for declared highlight parts and ignores elements that appear later in the step', async () => {
  const part = document.createElement('div')
  part.dataset.part = ''
  part.style.cssText = 'position: fixed; top: 200px; left: 16px; width: 120px; height: 40px'
  const latePart = part.cloneNode() as HTMLElement
  latePart.style.top = '320px'
  onTestFinished(() => {
    part.remove()
    latePart.remove()
  })

  const screen = await render(<Demo highlightSelectors={['[data-part]']} />)
  await expect.element(screen.getByRole('button', { name: 'First target' })).toBeVisible()
  expect(document.querySelector('[role="dialog"]')).toBeNull()

  document.body.append(part)
  const coachmark = screen.getByRole('dialog', { name: 'Start here' })
  await expect.element(coachmark).toBeVisible()
  const spotlight = screen.getByTestId('spotlight').element()
  const spotlightRect = spotlight.getBoundingClientRect().toJSON()
  expect(spotlightRect.bottom).toBe(244)
  const popupTop = coachmark.element().getBoundingClientRect().top

  document.body.append(latePart)
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  expect(spotlight.getBoundingClientRect().toJSON()).toEqual(spotlightRect)
  expect(coachmark.element().getBoundingClientRect().top).toBeCloseTo(popupTop, 0)
})

it('opens with highlight parts without waiting on animation frames', async () => {
  const part = document.createElement('div')
  part.dataset.part = ''
  part.style.cssText = 'position: fixed; top: 200px; left: 16px; width: 120px; height: 40px'
  document.body.append(part)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  onTestFinished(() => {
    vi.unstubAllGlobals()
    part.remove()
  })

  const screen = await render(<Demo highlightSelectors={['[data-part]']} />)

  await expect
    .element(screen.getByRole('dialog', { name: 'Start here' }), { timeout: 500 })
    .toBeInTheDocument()
})

it('skips hidden controls in the target when Tab leaves it', async () => {
  function HiddenControlDemo() {
    const [target, setTarget] = useState<HTMLElement | null>(null)
    return (
      <>
        <div ref={setTarget} style={{ margin: 16 }}>
          <button type="button">Visible control</button>
          <button type="button" style={{ visibility: 'hidden' }}>
            Hidden control
          </button>
        </div>
        <Coachmark defaultOpen target={target} modal="allow-target">
          <CoachmarkPortal>
            <CoachmarkPositioner>
              <CoachmarkPopup>
                <CoachmarkTitle>Start here</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        </Coachmark>
      </>
    )
  }
  const screen = await render(<HiddenControlDemo />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toHaveFocus()

  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('button', { name: 'Skip' })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('button', { name: 'Visible control' })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('button', { name: 'Skip' })).toHaveFocus()
})
