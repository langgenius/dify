import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Placement } from '.'
import { useState } from 'react'
import {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from '.'

const rowButtonClassName
  = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-secondary hover:bg-state-base-hover'

const triggerButtonClassName
  = 'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs hover:bg-state-base-hover'

const inlineLinkClassName
  = 'text-text-accent underline decoration-text-accent/60 decoration-1 underline-offset-2 outline-hidden hover:decoration-text-accent focus-visible:rounded-xs focus-visible:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-text-accent data-[popup-open]:decoration-text-accent'

const meta = {
  title: 'Base/UI/PreviewCard',
  component: PreviewCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Hover- and focus-activated rich preview for triggers whose primary click has its own destination (following a link, selecting a row, jumping to a definition). Built on Base UI PreviewCard.\n\n**A11y contract:** touch and screen-reader users cannot open the preview. Never place information or actions in the popup that are not also reachable from the trigger\'s primary click destination. If that is unavoidable, add a separate click affordance (Popover) or move the unique content onto the destination.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PreviewCard>

export default meta
type Story = StoryObj<typeof meta>

// --- Canonical: inline link preview ---------------------------------------
// Mirrors Base UI's own PreviewCard docs demo: an inline `<a href>` in a
// paragraph, hovering reveals a rich preview (image + summary) of the link's
// destination. The Wikipedia URL and Unsplash image are the exact assets used
// in base-ui.com's public docs so the story renders a real preview.
// https://base-ui.com/react/components/preview-card
const typographyPreview = createPreviewCardHandle()

export const LinkPreview: Story = {
  name: 'Link preview (canonical)',
  parameters: {
    docs: {
      description: {
        story:
          'The prototypical PreviewCard use case: an inline hyperlink with a rich hover preview of the destination. Uses a detached trigger + `createPreviewCardHandle()` so the trigger can sit inline in prose while the popup content is defined elsewhere. The trigger renders a real `<a href>` — click still follows the link; the preview is strictly supplementary.',
      },
    },
  },
  render: () => (
    <div className="max-w-md p-6 text-sm leading-6 text-text-secondary">
      <p>
        The principles of good
        {' '}
        <PreviewCardTrigger
          handle={typographyPreview}
          href="https://en.wikipedia.org/wiki/Typography"
          target="_blank"
          rel="noreferrer"
          className={inlineLinkClassName}
        >
          typography
        </PreviewCardTrigger>
        {' '}
        remain in the digital age.
      </p>

      <PreviewCard handle={typographyPreview}>
        <PreviewCardContent popupClassName="w-[240px] p-2">
          <div className="flex flex-col gap-2">
            <img
              width="224"
              height="150"
              className="block max-w-none rounded-md"
              src="https://images.unsplash.com/photo-1619615391095-dfa29e1672ef?q=80&w=448&h=300"
              alt="Station Hofplein signage in Rotterdam, Netherlands"
            />
            <p className="m-0 text-xs leading-5 text-text-secondary">
              <strong className="text-text-primary">Typography</strong>
              {' '}
              is the art and science of arranging type to make written language legible, readable, and visually appealing.
            </p>
          </div>
        </PreviewCardContent>
      </PreviewCard>
    </div>
  ),
}

export const Supplementary: Story = {
  name: 'Supplementary preview on a button trigger',
  parameters: {
    docs: {
      description: {
        story:
          'Application-level adaptation of the same semantic: the trigger is a `<button>` that owns a primary action (selecting a model row) rather than an `<a>`. The preview still only shows supplementary info reachable from the selection destination, so the a11y contract holds.',
      },
    },
  },
  render: () => (
    <PreviewCard>
      <PreviewCardTrigger
        render={(
          <button type="button" className={rowButtonClassName}>
            <span className="i-ri-sparkling-fill h-4 w-4 text-text-accent" />
            <span>gpt-4o</span>
          </button>
        )}
      />
      <PreviewCardContent
        placement="right"
        popupClassName="w-[220px] p-3"
      >
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-text-primary">gpt-4o</div>
          <div className="text-xs text-text-tertiary">
            Multimodal flagship model. Vision, audio and 128k context.
          </div>
        </div>
      </PreviewCardContent>
    </PreviewCard>
  ),
}

const PLACEMENTS: Placement[] = [
  'top-start',
  'top',
  'top-end',
  'right-start',
  'right',
  'right-end',
  'bottom-start',
  'bottom',
  'bottom-end',
  'left-start',
  'left',
  'left-end',
]

const PlacementsDemo = () => {
  const [placement, setPlacement] = useState<Placement>('bottom')

  return (
    <div className="flex flex-col items-center gap-4 p-20">
      <div className="grid grid-cols-3 gap-2 text-xs">
        {PLACEMENTS.map(value => (
          <button
            key={value}
            type="button"
            onClick={() => setPlacement(value)}
            className={`rounded-md border border-divider-subtle px-2 py-1 text-text-secondary ${
              placement === value ? 'bg-state-base-hover' : 'bg-components-button-secondary-bg'
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      <PreviewCard open>
        <PreviewCardTrigger
          render={<button type="button" className={triggerButtonClassName}>Hover me</button>}
        />
        <PreviewCardContent placement={placement} popupClassName="w-56 p-3">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-semibold text-text-primary">
              placement="
              {placement}
              "
            </div>
            <div className="text-xs text-text-secondary">
              Preview positions itself relative to the trigger.
            </div>
          </div>
        </PreviewCardContent>
      </PreviewCard>
    </div>
  )
}

export const Placements: Story = {
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <PlacementsDemo />,
}

const CustomDelayDemo = () => (
  <PreviewCard>
    <PreviewCardTrigger
      delay={100}
      closeDelay={100}
      render={<button type="button" className={triggerButtonClassName}>Snappy trigger</button>}
    />
    <PreviewCardContent popupClassName="w-64 p-3">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold text-text-primary">Fast hover</div>
        <div className="text-xs text-text-secondary">
          Base UI defaults (600ms / 300ms) are tuned for link previews. Override per trigger for denser UIs.
        </div>
      </div>
    </PreviewCardContent>
  </PreviewCard>
)

export const CustomDelays: Story = {
  render: () => <CustomDelayDemo />,
}
