import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
  Coachmark,
  CoachmarkActions,
  CoachmarkArrow,
  CoachmarkClose,
  CoachmarkDescription,
  CoachmarkPopup,
  CoachmarkPortal,
  CoachmarkPositioner,
  CoachmarkSpotlight,
  CoachmarkStepLabel,
  CoachmarkTitle,
} from '.'
import { Button } from '../button'
import { Switch } from '../switch'

type TourStep = {
  id: 'invite' | 'keys' | 'security'
  title: string
  description: string
  side: 'bottom' | 'inline-end'
  action?: string
}

const steps: TourStep[] = [
  {
    id: 'invite',
    title: 'Invite your team',
    description: 'Members you invite can build and publish apps in this workspace.',
    side: 'bottom',
    action: 'Next',
  },
  {
    id: 'keys',
    title: 'Manage API keys',
    description: 'Create keys for each environment and revoke the ones you no longer use.',
    side: 'inline-end',
    action: 'Next',
  },
  {
    id: 'security',
    title: 'Turn on two-factor sign-in to finish',
    description: 'Members will confirm sign-in with a code from their phone.',
    side: 'bottom',
  },
]

const meta = {
  title: 'Base/Feedback/Coachmark',
  component: Coachmark,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Guides users through elements that already exist on the page. The owner keeps the step and passes the current `target`, as an element or a selector that matches a single element; Coachmark waits until the target is visible and accessible, scrolls it into view, dims the rest of the page and points at it. It steps aside while another modal covers it and returns when the target is reachable again. Pass the step as `payload` so the previous content stays in place while the next target is pending. `onOpenChange` reports only Escape and the close part, and `onStepShown` runs once each step is shown. Elements matched by `highlightSelectors` are lit up but stay inert. Use `modal="allow-target"` for a step the user finishes by using the target; the rest of the page stays blocked. With the default `modal`, render a `CoachmarkClose` so focus stays in the popup. Keep focus inside the popup on every step: point `initialFocus` at the primary action when the step has one, otherwise let the popup take focus so its title and description are announced before the user tabs to the target.',
      },
    },
  },
} satisfies Meta<typeof Coachmark>

export default meta
type Story = StoryObj<typeof meta>

function SettingsTour() {
  const [index, setIndex] = React.useState<number | null>(null)
  const [twoFactor, setTwoFactor] = React.useState(false)
  const [targets, setTargets] = React.useState<Partial<Record<TourStep['id'], HTMLElement | null>>>(
    {},
  )
  const [targetRefs] = React.useState(() => ({
    invite: (element: HTMLElement | null) =>
      setTargets((current) => ({ ...current, invite: element })),
    keys: (element: HTMLElement | null) => setTargets((current) => ({ ...current, keys: element })),
    security: (element: HTMLElement | null) =>
      setTargets((current) => ({ ...current, security: element })),
  }))
  const step = index === null ? undefined : steps[index]
  const actionRef = React.useRef<HTMLButtonElement>(null)

  return (
    <div className="flex min-h-screen flex-col bg-background-body">
      <header className="flex items-center justify-between border-b border-divider-subtle px-6 py-4">
        <h1 className="system-xl-semibold text-text-primary">Workspace settings</h1>
        <Button
          variant="secondary"
          onClick={() => {
            setTwoFactor(false)
            setIndex(0)
          }}
        >
          Start tour
        </Button>
      </header>
      <div className="flex flex-1">
        <nav aria-label="Settings" className="flex w-56 flex-col gap-1 p-4">
          <a href="#members" className="rounded-lg px-3 py-2 system-sm-medium text-text-secondary">
            Members
          </a>
          <a
            ref={targetRefs.keys}
            href="#keys"
            className="rounded-lg px-3 py-2 system-sm-medium text-text-secondary"
          >
            API keys
          </a>
          <a href="#billing" className="rounded-lg px-3 py-2 system-sm-medium text-text-secondary">
            Billing
          </a>
        </nav>
        <main className="flex max-w-2xl flex-1 flex-col gap-4 p-6">
          <section className="flex items-center justify-between rounded-xl border border-divider-subtle bg-components-panel-bg p-4">
            <div>
              <h2 className="system-md-semibold text-text-primary">Members</h2>
              <p className="system-xs-regular text-text-tertiary">3 of 10 seats used</p>
            </div>
            <Button ref={targetRefs.invite} variant="primary">
              Invite members
            </Button>
          </section>
          <section className="flex items-center justify-between rounded-xl border border-divider-subtle bg-components-panel-bg p-4">
            <div className="flex flex-col">
              <h2 id="two-factor" className="system-md-semibold text-text-primary">
                Two-factor sign-in
              </h2>
              <p className="system-xs-regular text-text-tertiary">
                Require a code at every sign-in
              </p>
            </div>
            <Switch
              ref={targetRefs.security}
              aria-labelledby="two-factor"
              checked={twoFactor}
              onCheckedChange={(checked) => {
                setTwoFactor(checked)
                if (checked && step?.id === 'security') setIndex(null)
              }}
            />
          </section>
        </main>
      </div>
      <Coachmark
        open={step !== undefined}
        onOpenChange={() => setIndex(null)}
        target={step ? (targets[step.id] ?? null) : null}
        modal={step?.action ? true : 'allow-target'}
        payload={{ index: index ?? 0, step: step ?? steps[0]! }}
      >
        {({ payload: { index: shownIndex, step: shown } }) => (
          <CoachmarkPortal>
            <CoachmarkSpotlight />
            <CoachmarkPositioner side={shown.side}>
              <CoachmarkPopup
                initialFocus={shown.action ? actionRef : undefined}
                className="min-h-39.5"
              >
                <CoachmarkArrow />
                <CoachmarkTitle>
                  <CoachmarkStepLabel>
                    Step {shownIndex + 1} of {steps.length}
                  </CoachmarkStepLabel>
                  {shown.title}
                </CoachmarkTitle>
                <CoachmarkDescription>{shown.description}</CoachmarkDescription>
                <CoachmarkActions>
                  <CoachmarkClose>Skip tour</CoachmarkClose>
                  {shown.action && (
                    <Button
                      ref={actionRef}
                      variant="primary"
                      className="min-w-20 in-data-pending:opacity-50"
                      onClick={() => setIndex(shownIndex + 1)}
                    >
                      {shown.action}
                    </Button>
                  )}
                </CoachmarkActions>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        )}
      </Coachmark>
    </div>
  )
}

export const Tour: Story = {
  args: { open: false, target: null },
  render: () => <SettingsTour />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole('button', { name: 'Start tour' }))

    await body.findByRole('dialog', { name: 'Step 1 of 3 Invite your team' })
    await waitFor(() => expect(body.getByRole('button', { name: 'Next' })).toHaveFocus())
    await userEvent.click(body.getByRole('button', { name: 'Next' }))

    await body.findByRole('dialog', { name: 'Step 2 of 3 Manage API keys' })
    await waitFor(() => expect(body.getByRole('button', { name: 'Next' })).toHaveFocus())
    await userEvent.click(body.getByRole('button', { name: 'Next' }))

    await body.findByRole('dialog', { name: 'Step 3 of 3 Turn on two-factor sign-in to finish' })
    const step = body.getByRole('dialog', {
      name: 'Step 3 of 3 Turn on two-factor sign-in to finish',
    })
    await waitFor(() => expect(step).toHaveFocus())
    await userEvent.click(body.getByRole('switch', { name: 'Two-factor sign-in' }))
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
    await expect(body.getByRole('switch', { name: 'Two-factor sign-in' })).toBeChecked()
  },
}
