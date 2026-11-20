import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from '@langgenius/dify-ui/button'
import { useRef, useState } from 'react'
import {
  Coachmark,
  CoachmarkArrow,
  CoachmarkClose,
  CoachmarkDescription,
  CoachmarkPopup,
  CoachmarkPortal,
  CoachmarkPositioner,
  CoachmarkSpotlight,
  CoachmarkTitle,
} from '.'

const steps = [
  { id: 'create', title: 'Create an app', description: 'Start from a blank app or a template.' },
  { id: 'explore', title: 'Explore templates', description: 'Browse ready-made apps.' },
]

const meta = {
  title: 'Base/Feedback/Coachmark',
  component: Coachmark,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Popover anchored to an arbitrary page element with a spotlight cut-out. The root waits until the target is measured, visible and accessible, keeps the last ready step in place while the next target settles, and glides between steps.',
      },
    },
  },
} satisfies Meta<typeof Coachmark>

export default meta
type Story = StoryObj<typeof meta>

function Tour() {
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(true)
  const [targets, setTargets] = useState<Record<string, HTMLElement | null>>({})
  const nextRef = useRef<HTMLButtonElement>(null)
  const [targetRefs] = useState(() =>
    Object.fromEntries(
      steps.map(({ id }) => [
        id,
        (element: HTMLElement | null) =>
          setTargets((current) =>
            current[id] === element ? current : { ...current, [id]: element },
          ),
      ]),
    ),
  )
  const step = steps[index]!

  return (
    <div className="flex gap-40">
      {steps.map(({ id, title }) => (
        <Button key={id} ref={targetRefs[id]}>
          {title}
        </Button>
      ))}
      {open && (
        <Coachmark
          target={targets[step.id] ?? null}
          step={step.id}
          payload={step}
          onOpenChange={(nextOpen) => setOpen(nextOpen)}
        >
          {({ payload }) => (
            <CoachmarkPortal>
              <CoachmarkSpotlight />
              <CoachmarkPositioner>
                <CoachmarkPopup initialFocus={nextRef}>
                  <CoachmarkArrow />
                  <CoachmarkTitle className="system-md-medium text-text-primary">
                    {payload.title}
                  </CoachmarkTitle>
                  <CoachmarkDescription className="mt-1 system-xs-regular text-text-secondary">
                    {payload.description}
                  </CoachmarkDescription>
                  <div className="mt-4 flex items-center justify-between">
                    <CoachmarkClose className="system-sm-regular text-text-tertiary">
                      Skip
                    </CoachmarkClose>
                    <Button
                      ref={nextRef}
                      variant="primary"
                      onClick={() => setIndex((current) => (current + 1) % steps.length)}
                    >
                      Next
                    </Button>
                  </div>
                </CoachmarkPopup>
              </CoachmarkPositioner>
            </CoachmarkPortal>
          )}
        </Coachmark>
      )}
    </div>
  )
}

export const Default: Story = {
  args: { target: null, children: null },
  render: () => <Tour />,
}
