import type { CoachmarkProps } from '..'
import * as React from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
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
import { Dialog, DialogContent, DialogTitle } from '../../dialog'
import { DirectionProvider } from '../../direction-provider'

type Step = 'first' | 'second'

type DemoProps = Partial<
  Pick<CoachmarkProps, 'highlightSelectors' | 'onOpenChange' | 'onStepShown' | 'open'>
> & {
  modal?: CoachmarkProps['modal']
  onStepShown?: (step: Step) => void
  step?: Step
  secondTargetMounted?: boolean
  onNext?: () => void
}

function Demo({
  modal,
  open = true,
  onOpenChange,
  onStepShown,
  highlightSelectors,
  step = 'first',
  secondTargetMounted = true,
  onNext,
}: DemoProps) {
  const [targets, setTargets] = React.useState<Partial<Record<Step, HTMLElement | null>>>({})
  const [targetRefs] = React.useState(() => ({
    first: (element: HTMLElement | null) =>
      setTargets((current) => ({ ...current, first: element })),
    second: (element: HTMLElement | null) =>
      setTargets((current) => ({ ...current, second: element })),
  }))
  const actionRef = React.useRef<HTMLButtonElement>(null)

  return (
    <React.Fragment>
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
        onOpenChange={onOpenChange}
        onStepShown={onStepShown}
        target={targets[step] ?? null}
        highlightSelectors={highlightSelectors}
        modal={modal}
        payload={step}
      >
        {({ payload }) => (
          <CoachmarkPortal>
            <CoachmarkSpotlight data-testid="spotlight" />
            <CoachmarkPositioner data-testid="positioner">
              <CoachmarkPopup initialFocus={actionRef}>
                <CoachmarkArrow data-testid="arrow" />
                <CoachmarkTitle>{payload === 'first' ? 'Start here' : 'Then here'}</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
                <button ref={actionRef} type="button" onClick={onNext}>
                  Next
                </button>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        )}
      </Coachmark>
    </React.Fragment>
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

it.each(['ltr', 'rtl'] as const)(
  'lines the popup up with the start of the target in %s',
  async (direction) => {
    await page.viewport(1280, 720)
    document.documentElement.dir = direction
    onTestFinished(() => document.documentElement.removeAttribute('dir'))
    const screen = await render(
      <DirectionProvider direction={direction}>
        <Demo />
      </DirectionProvider>,
    )

    const coachmark = screen.getByRole('dialog', { name: 'Start here' })
    await expect.element(coachmark).toBeVisible()
    const target = screen.getByText('First target').element().getBoundingClientRect()
    const popup = coachmark.element().getBoundingClientRect()
    if (direction === 'rtl') expect(Math.abs(popup.right - target.right)).toBeLessThanOrEqual(2)
    else expect(Math.abs(popup.left - target.left)).toBeLessThanOrEqual(2)
  },
)

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

it('keeps the shown step while the next target is pending, then glides to it', async () => {
  const onNext = vi.fn()
  const screen = await render(<Demo onNext={onNext} secondTargetMounted={false} />)
  const coachmark = screen.getByRole('dialog', { name: 'Start here' })
  await expect.element(coachmark).toBeVisible()

  await screen.rerender(<Demo onNext={onNext} step="second" secondTargetMounted={false} />)
  await expect.element(coachmark).toHaveAttribute('data-pending')
  await expect.element(coachmark).toHaveAttribute('aria-busy', 'true')
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()
  await screen.getByRole('button', { name: 'Next' }).click()
  expect(onNext).not.toHaveBeenCalled()

  await screen.rerender(<Demo onNext={onNext} step="second" />)
  const second = screen.getByRole('dialog', { name: 'Then here' })
  await expect.element(second).toBeVisible()
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
    const [target, setTarget] = React.useState<HTMLElement | null>(null)
    return (
      <React.Fragment>
        <div ref={setTarget} style={{ margin: 16 }}>
          <button type="button">Visible control</button>
          <button type="button" style={{ visibility: 'hidden' }}>
            Hidden control
          </button>
        </div>
        <Coachmark open target={target} modal="allow-target">
          <CoachmarkPortal>
            <CoachmarkPositioner>
              <CoachmarkPopup>
                <CoachmarkTitle>Start here</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        </Coachmark>
      </React.Fragment>
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

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

it('reports each target once it is shown', async () => {
  const onStepShown = vi.fn()
  const screen = await render(<Demo onStepShown={onStepShown} />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()
  expect(onStepShown).toHaveBeenCalledTimes(1)
  expect(onStepShown).toHaveBeenLastCalledWith('first')

  await screen.rerender(<Demo onStepShown={onStepShown} step="second" />)
  await expect.element(screen.getByRole('dialog', { name: 'Then here' })).toBeVisible()
  expect(onStepShown).toHaveBeenCalledTimes(2)
  expect(onStepShown).toHaveBeenLastCalledWith('second')
})

it('ends the glide once both the spotlight and the popup finish moving', async () => {
  const flags = globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  const animationsDisabled = flags.BASE_UI_ANIMATIONS_DISABLED
  flags.BASE_UI_ANIMATIONS_DISABLED = false
  onTestFinished(() => {
    flags.BASE_UI_ANIMATIONS_DISABLED = animationsDisabled
  })
  const screen = await render(<Demo />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()
  const spotlight = screen.getByTestId('spotlight')
  await expect.element(spotlight).not.toHaveAttribute('data-starting-style')
  await expect.poll(() => spotlight.element().getAnimations()).toHaveLength(0)

  await screen.rerender(<Demo step="second" />)
  await expect.element(spotlight).toHaveAttribute('data-gliding')
  expect(spotlight.element().getAnimations().length).toBeGreaterThan(0)
  await expect.element(spotlight).not.toHaveAttribute('data-gliding')
  expect(spotlight.element().getAnimations()).toHaveLength(0)
  expect(screen.getByTestId('positioner').element().getAnimations()).toHaveLength(0)
})

it('keeps focus in the popup when the dimmed page is clicked', async () => {
  const screen = await render(<Demo modal="allow-target" />)
  const next = screen.getByRole('button', { name: 'Next' })
  await expect.element(next).toHaveFocus()

  const outside = screen.getByRole('button', { name: 'Outside' }).element().getBoundingClientRect()
  await userEvent.click(document.body, {
    position: { x: outside.left + outside.width / 2, y: outside.top + outside.height / 2 },
  })
  await expect.element(next).toHaveFocus()
})

it('scrolls a target outside the viewport into view before showing it', async () => {
  await page.viewport(800, 600)
  function FarDemo() {
    const [target, setTarget] = React.useState<HTMLElement | null>(null)
    return (
      <React.Fragment>
        <div style={{ height: 2000 }} />
        <button ref={setTarget} type="button">
          Far target
        </button>
        <Coachmark open target={target}>
          <CoachmarkPortal>
            <CoachmarkPositioner>
              <CoachmarkPopup>
                <CoachmarkTitle>Far step</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        </Coachmark>
      </React.Fragment>
    )
  }
  onTestFinished(() => window.scrollTo(0, 0))
  const screen = await render(<FarDemo />)

  await expect.element(screen.getByRole('dialog', { name: 'Far step' })).toBeVisible()
  const rect = screen.getByText('Far target').element().getBoundingClientRect()
  expect(rect.top).toBeGreaterThanOrEqual(0)
  expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight)
})

it('follows a target inside a scroll container and keeps Skip reachable after it scrolls away', async () => {
  await page.viewport(800, 600)
  function ScrollDemo() {
    const [target, setTarget] = React.useState<HTMLElement | null>(null)
    return (
      <div data-testid="scroller" style={{ height: 300, overflow: 'auto', marginTop: 100 }}>
        <div style={{ height: 40 }} />
        <button ref={setTarget} type="button">
          Scrolled target
        </button>
        <div style={{ height: 1200 }} />
        <Coachmark open target={target}>
          <CoachmarkPortal>
            <CoachmarkSpotlight data-testid="spotlight" />
            <CoachmarkPositioner>
              <CoachmarkPopup>
                <CoachmarkTitle>Scrolled step</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        </Coachmark>
      </div>
    )
  }
  const screen = await render(<ScrollDemo />)
  const coachmark = screen.getByRole('dialog', { name: 'Scrolled step' })
  await expect.element(coachmark).toBeVisible()

  screen.getByTestId('scroller').element().scrollTop = 30
  const target = screen.getByText('Scrolled target').element()
  await expect
    .poll(() => screen.getByTestId('spotlight').element().getBoundingClientRect().top)
    .toBeCloseTo(target.getBoundingClientRect().top - 4, 0)
  await expect
    .poll(() => coachmark.element().getBoundingClientRect().top)
    .toBeCloseTo(target.getBoundingClientRect().bottom + 25, 0)

  screen.getByTestId('scroller').element().scrollTop = 900
  await nextFrame()
  const skip = screen.getByRole('button', { name: 'Skip' })
  await expect.element(skip).toBeVisible()
  const popup = coachmark.element().getBoundingClientRect()
  expect(popup.top).toBeGreaterThanOrEqual(0)
  expect(popup.bottom).toBeLessThanOrEqual(window.innerHeight)
})

it('queries the highlight parts again when the same target gets new selectors', async () => {
  const first = document.createElement('div')
  first.dataset.first = ''
  first.style.cssText = 'position: fixed; top: 200px; left: 16px; width: 120px; height: 40px'
  const second = document.createElement('div')
  second.dataset.second = ''
  second.style.cssText = 'position: fixed; top: 300px; left: 16px; width: 120px; height: 40px'
  document.body.append(first, second)
  onTestFinished(() => {
    first.remove()
    second.remove()
  })

  const screen = await render(<Demo highlightSelectors={['[data-first]']} />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()
  const spotlight = screen.getByTestId('spotlight').element()
  expect(spotlight.getBoundingClientRect().bottom).toBe(244)

  await screen.rerender(<Demo highlightSelectors={['[data-second]']} />)
  await expect.poll(() => spotlight.getBoundingClientRect().bottom).toBe(344)
})

it('points the connector at the middle of a target narrower than its inset', async () => {
  function NarrowDemo() {
    const [target, setTarget] = React.useState<HTMLElement | null>(null)
    return (
      <React.Fragment>
        <button ref={setTarget} type="button" style={{ margin: 40, width: 24, padding: 0 }}>
          N
        </button>
        <Coachmark open target={target}>
          <CoachmarkPortal>
            <CoachmarkPositioner>
              <CoachmarkPopup>
                <CoachmarkArrow data-testid="arrow" />
                <CoachmarkTitle>Narrow step</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        </Coachmark>
      </React.Fragment>
    )
  }
  const screen = await render(<NarrowDemo />)
  await expect.element(screen.getByRole('dialog', { name: 'Narrow step' })).toBeVisible()
  const target = screen.getByText('N').element().getBoundingClientRect()
  const arrow = screen.getByTestId('arrow').element().getBoundingClientRect()
  const arrowCenter = arrow.left + arrow.width / 2
  expect(arrowCenter).toBeGreaterThan(target.left)
  expect(arrowCenter).toBeLessThan(target.right)
})

it.each([
  ['bottom', 'top'],
  ['inline-end', 'left'],
] as const)(
  'draws the connector from the popup toward the target on the %s side',
  async (side, edge) => {
    await page.viewport(1280, 720)
    function SideDemo() {
      const [target, setTarget] = React.useState<HTMLElement | null>(null)
      return (
        <React.Fragment>
          <button ref={setTarget} type="button" style={{ margin: 80 }}>
            Side target
          </button>
          <Coachmark open target={target}>
            <CoachmarkPortal>
              <CoachmarkPositioner side={side}>
                <CoachmarkPopup>
                  <CoachmarkArrow data-testid="arrow" />
                  <CoachmarkTitle>Side step</CoachmarkTitle>
                  <CoachmarkClose>Skip</CoachmarkClose>
                </CoachmarkPopup>
              </CoachmarkPositioner>
            </CoachmarkPortal>
          </Coachmark>
        </React.Fragment>
      )
    }
    const screen = await render(<SideDemo />)
    const coachmark = screen.getByRole('dialog', { name: 'Side step' })
    await expect.element(coachmark).toBeVisible()
    const arrow = screen.getByTestId('arrow').element()
    await expect
      .poll(() =>
        Math.abs(
          coachmark.element().getBoundingClientRect()[edge] -
            arrow.getBoundingClientRect()[edge] -
            24,
        ),
      )
      .toBeLessThanOrEqual(1)
  },
)

it('shows a target that marks itself hidden from assistive technology', async () => {
  function DecorativeDemo() {
    const [target, setTarget] = React.useState<HTMLElement | null>(null)
    return (
      <div style={{ position: 'relative', margin: 40, width: 160, height: 32 }}>
        <span ref={setTarget} aria-hidden="true" style={{ position: 'absolute', inset: 0 }} />
        <Coachmark open target={target}>
          <CoachmarkPortal>
            <CoachmarkPositioner>
              <CoachmarkPopup>
                <CoachmarkTitle>Decorative step</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        </Coachmark>
      </div>
    )
  }
  const screen = await render(<DecorativeDemo />)
  await expect.element(screen.getByRole('dialog', { name: 'Decorative step' })).toBeVisible()
})

it.each(['hidden', 'removed'] as const)(
  'closes without moving the popup when the target is %s',
  async (change) => {
    const screen = await render(<Demo />)
    const coachmark = screen.getByRole('dialog', { name: 'Start here' })
    await expect.element(coachmark).toBeVisible()
    const positioner = screen.getByTestId('positioner').element()
    const before = positioner.getBoundingClientRect()

    const target = screen.getByText('First target').element() as HTMLElement
    const positions: DOMRect[] = []
    const sample = () => {
      if (!positioner.isConnected) return
      positions.push(positioner.getBoundingClientRect())
      requestAnimationFrame(sample)
    }
    const { nextSibling, parentElement } = target
    onTestFinished(() => {
      if (!target.isConnected) parentElement?.insertBefore(target, nextSibling)
    })
    if (change === 'hidden') target.style.display = 'none'
    else target.remove()
    sample()

    await expect.element(coachmark).not.toBeInTheDocument()
    expect(positions.length).toBeGreaterThan(0)
    for (const position of positions) {
      expect(position.top).toBeCloseTo(before.top, 0)
      expect(position.left).toBeCloseTo(before.left, 0)
    }
  },
)

it('finds a selector target again after it remounts', async () => {
  function SelectorDemo({ version }: { version: number }) {
    return (
      <React.Fragment>
        <button key={version} type="button" data-tour-target="" style={{ margin: 40 }}>
          Target {version}
        </button>
        <Coachmark open target="[data-tour-target]">
          <CoachmarkPortal>
            <CoachmarkPositioner>
              <CoachmarkPopup>
                <CoachmarkTitle>Selector step</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        </Coachmark>
      </React.Fragment>
    )
  }
  const screen = await render(<SelectorDemo version={1} />)
  const coachmark = screen.getByRole('dialog', { name: 'Selector step' })
  await expect.element(coachmark).toBeVisible()

  await screen.rerender(<SelectorDemo version={2} />)
  await expect.element(screen.getByRole('dialog', { name: 'Selector step' })).toBeVisible()
})

it('keeps highlight parts inert while they are lit up', async () => {
  const part = document.createElement('button')
  part.dataset.part = ''
  part.textContent = 'Part action'
  part.style.cssText = 'position: fixed; top: 200px; left: 16px; width: 120px; height: 40px'
  document.body.append(part)
  onTestFinished(() => part.remove())

  const screen = await render(<Demo highlightSelectors={['[data-part]']} />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()
  expect(part.inert).toBe(true)

  await screen.rerender(<Demo open={false} highlightSelectors={['[data-part]']} />)
  await expect.poll(() => part.inert).toBe(false)
})

it('steps aside while another modal covers it and comes back afterwards', async () => {
  function CoveredDemo({ covered }: { covered: boolean }) {
    return (
      <React.Fragment>
        <Demo />
        <Dialog open={covered}>
          <DialogContent>
            <DialogTitle>Editor</DialogTitle>
          </DialogContent>
        </Dialog>
      </React.Fragment>
    )
  }
  const screen = await render(<CoveredDemo covered={false} />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()

  await screen.rerender(<CoveredDemo covered />)
  await expect.element(screen.getByRole('dialog', { name: 'Editor' })).toBeVisible()
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).not.toBeInTheDocument()

  await screen.rerender(<CoveredDemo covered={false} />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()
})

it('blocks the page even when no spotlight is rendered', async () => {
  function PlainDemo() {
    const [target, setTarget] = React.useState<HTMLElement | null>(null)
    return (
      <React.Fragment>
        <button type="button" style={{ margin: 16 }}>
          Outside
        </button>
        <button ref={setTarget} type="button" style={{ margin: 16 }}>
          Plain target
        </button>
        <Coachmark open target={target}>
          <CoachmarkPortal>
            <CoachmarkPositioner>
              <CoachmarkPopup>
                <CoachmarkTitle>Plain step</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        </Coachmark>
      </React.Fragment>
    )
  }
  const screen = await render(<PlainDemo />)
  await expect.element(screen.getByRole('dialog', { name: 'Plain step' })).toBeVisible()
  const outside = screen.getByRole('button', { name: 'Outside', includeHidden: true }).element()
  expect(pointAt(outside)).not.toBe(outside)
})

it('does not wait for an endless animation inside a highlight part', async () => {
  const part = document.createElement('div')
  part.dataset.part = ''
  part.style.cssText = 'position: fixed; top: 200px; left: 16px; width: 120px; height: 40px'
  part.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 500, iterations: Infinity })
  document.body.append(part)
  onTestFinished(() => part.remove())

  const screen = await render(<Demo highlightSelectors={['[data-part]']} />)
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()
})

it('scrolls a partly visible target fully into view', async () => {
  await page.viewport(800, 600)
  function EdgeDemo() {
    const [target, setTarget] = React.useState<HTMLElement | null>(null)
    return (
      <React.Fragment>
        <div style={{ height: 580 }} />
        <button ref={setTarget} type="button" style={{ height: 60 }}>
          Edge target
        </button>
        <div style={{ height: 600 }} />
        <Coachmark open target={target}>
          <CoachmarkPortal>
            <CoachmarkPositioner>
              <CoachmarkPopup>
                <CoachmarkTitle>Edge step</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        </Coachmark>
      </React.Fragment>
    )
  }
  onTestFinished(() => window.scrollTo(0, 0))
  const screen = await render(<EdgeDemo />)
  await expect.element(screen.getByRole('dialog', { name: 'Edge step' })).toBeVisible()
  const rect = screen.getByText('Edge target').element().getBoundingClientRect()
  expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight)
})

it('waits for a highlight part to leave its starting style before measuring it', async () => {
  const part = document.createElement('div')
  part.dataset.part = ''
  part.setAttribute('data-starting-style', '')
  part.style.cssText =
    'position: fixed; top: 200px; left: 16px; width: 120px; height: 40px; transform: scale(0.5)'
  document.body.append(part)
  onTestFinished(() => part.remove())

  const screen = await render(<Demo highlightSelectors={['[data-part]']} />)
  await nextFrame()
  expect(document.querySelector('[role="dialog"]')).toBeNull()

  part.style.transform = ''
  part.removeAttribute('data-starting-style')
  await expect.element(screen.getByRole('dialog', { name: 'Start here' })).toBeVisible()
  expect(screen.getByTestId('spotlight').element().getBoundingClientRect().bottom).toBe(244)
})

it('moves to the new element when a selector target is reassigned', async () => {
  function ListDemo({ first }: { first: 'a' | 'b' }) {
    return (
      <React.Fragment>
        <button
          type="button"
          data-tour-first={first === 'a' ? '' : undefined}
          style={{ margin: 40 }}
        >
          Card A
        </button>
        <button
          type="button"
          data-tour-first={first === 'b' ? '' : undefined}
          style={{ margin: 40 }}
        >
          Card B
        </button>
        <Coachmark open target="[data-tour-first]">
          <CoachmarkPortal>
            <CoachmarkSpotlight data-testid="spotlight" />
            <CoachmarkPositioner>
              <CoachmarkPopup>
                <CoachmarkTitle>First card</CoachmarkTitle>
                <CoachmarkClose>Skip</CoachmarkClose>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        </Coachmark>
      </React.Fragment>
    )
  }
  const screen = await render(<ListDemo first="a" />)
  await expect.element(screen.getByRole('dialog', { name: 'First card' })).toBeVisible()

  await screen.rerender(<ListDemo first="b" />)
  const cardB = screen.getByRole('button', { name: 'Card B', includeHidden: true }).element()
  await expect
    .poll(() => screen.getByTestId('spotlight').query()?.getBoundingClientRect().top)
    .toBeCloseTo(cardB.getBoundingClientRect().top - 4, 0)
})

it('waits for an animating ancestor of the target before measuring it', async () => {
  const container = document.createElement('div')
  container.style.cssText = 'position: fixed; top: 200px; left: 40px'
  const target = document.createElement('button')
  target.textContent = 'Dialog target'
  target.style.cssText = 'width: 120px; height: 40px'
  container.append(target)
  document.body.append(container)
  const animation = container.animate([{ scale: 0.5 }, { scale: 1 }], { duration: 300 })
  onTestFinished(() => container.remove())

  function AnimatedDemo() {
    return (
      <Coachmark open target={target}>
        <CoachmarkPortal>
          <CoachmarkSpotlight data-testid="spotlight" />
          <CoachmarkPositioner>
            <CoachmarkPopup>
              <CoachmarkTitle>Animated step</CoachmarkTitle>
              <CoachmarkClose>Skip</CoachmarkClose>
            </CoachmarkPopup>
          </CoachmarkPositioner>
        </CoachmarkPortal>
      </Coachmark>
    )
  }
  const screen = await render(<AnimatedDemo />)
  await expect.element(screen.getByRole('dialog', { name: 'Animated step' })).toBeVisible()
  expect(animation.playState).toBe('finished')
  expect(screen.getByTestId('spotlight').element().getBoundingClientRect().width).toBe(128)
})

it('opens the next step in place instead of gliding when the previous target is gone', async () => {
  const flags = globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  const animationsDisabled = flags.BASE_UI_ANIMATIONS_DISABLED
  flags.BASE_UI_ANIMATIONS_DISABLED = false
  onTestFinished(() => {
    flags.BASE_UI_ANIMATIONS_DISABLED = animationsDisabled
  })
  function HandoffDemo({ step }: { step: 'first' | 'second' }) {
    const [target, setTarget] = React.useState<HTMLElement | null>(null)
    return (
      <React.Fragment>
        {step === 'first' ? (
          <button key="first" ref={setTarget} type="button" style={{ margin: 40 }}>
            Lesson card
          </button>
        ) : (
          <button key="second" ref={setTarget} type="button" style={{ margin: 200 }}>
            Create from lesson
          </button>
        )}
        <Coachmark open target={target} payload={step}>
          {({ payload }) => (
            <CoachmarkPortal>
              <CoachmarkSpotlight data-testid="spotlight" />
              <CoachmarkPositioner>
                <CoachmarkPopup>
                  <CoachmarkTitle>{payload}</CoachmarkTitle>
                  <CoachmarkClose>Skip</CoachmarkClose>
                </CoachmarkPopup>
              </CoachmarkPositioner>
            </CoachmarkPortal>
          )}
        </Coachmark>
      </React.Fragment>
    )
  }
  const screen = await render(<HandoffDemo step="first" />)
  await expect.element(screen.getByRole('dialog', { name: 'first' })).toBeVisible()

  const glided: boolean[] = []
  const observer = new MutationObserver(() => {
    glided.push(!!document.querySelector('[data-gliding]'))
  })
  observer.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-gliding'],
  })
  onTestFinished(() => observer.disconnect())

  await screen.rerender(<HandoffDemo step="second" />)
  await expect.element(screen.getByRole('dialog', { name: 'second' })).toBeVisible()
  expect(glided).not.toContain(true)
})

it('stays above a dialog that opens with the next target inside it', async () => {
  const flags = globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  const animationsDisabled = flags.BASE_UI_ANIMATIONS_DISABLED
  flags.BASE_UI_ANIMATIONS_DISABLED = false
  onTestFinished(() => {
    flags.BASE_UI_ANIMATIONS_DISABLED = animationsDisabled
  })
  function DialogStepDemo({ step }: { step: 'card' | 'create' }) {
    return (
      <React.Fragment>
        {step === 'card' && (
          <button type="button" data-step-target="card" style={{ margin: 40 }}>
            Lesson card
          </button>
        )}
        <Dialog open={step === 'create'}>
          <DialogContent>
            <DialogTitle>Lesson</DialogTitle>
            <button type="button" data-step-target="create">
              Create from lesson
            </button>
          </DialogContent>
        </Dialog>
        <Coachmark open target={`[data-step-target="${step}"]`} modal="allow-target" payload={step}>
          {({ payload }) => (
            <CoachmarkPortal>
              <CoachmarkSpotlight />
              <CoachmarkPositioner>
                <CoachmarkPopup>
                  <CoachmarkTitle>{payload}</CoachmarkTitle>
                  <CoachmarkClose>Skip</CoachmarkClose>
                </CoachmarkPopup>
              </CoachmarkPositioner>
            </CoachmarkPortal>
          )}
        </Coachmark>
      </React.Fragment>
    )
  }
  const screen = await render(<DialogStepDemo step="card" />)
  await expect.element(screen.getByRole('dialog', { name: 'card' })).toBeVisible()

  await screen.rerender(<DialogStepDemo step="create" />)
  const coachmark = screen.getByRole('dialog', { name: 'create' })
  await expect.element(coachmark).toBeVisible()
  const skip = screen.getByRole('button', { name: 'Skip' }).element()
  await expect.poll(() => pointAt(skip)).toBe(skip)
})
