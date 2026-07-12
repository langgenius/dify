import type { Meta, StoryObj } from '@storybook/react-vite'
import type * as React from 'react'
import {
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '.'
import { cn } from '../cn'

const meta = {
  title: 'Base/UI/ScrollArea',
  component: ScrollAreaRoot,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Compound scroll container built on Base UI Scroll Area. The examples mirror the upstream anatomy and focus patterns while applying Dify UI tokens and surface treatments. Base UI ScrollArea.Content defaults to min-width: fit-content, so vertical-only regions that should truncate long content must set min-width: 0 on the content slot.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ScrollAreaRoot>

export default meta
type Story = StoryObj<typeof meta>

const verticalContentStyle = { minWidth: 0 } satisfies React.CSSProperties

const articleParagraphs = [
  'Vernacular architecture is building done outside any academic tradition, and without professional guidance. It is not a particular architectural movement or style, but rather a broad category, encompassing a wide range and variety of building types, with differing methods of construction, from around the world, both historical and extant and classical and modern.',
  'This type of architecture usually serves immediate, local needs, is constrained by the materials available in its particular region, and reflects local traditions and cultural practices. The study of vernacular architecture does not examine formally schooled architects, but instead the design skills and tradition of local builders.',
  'A scroll area follows the same principle in an interface. The viewport owns scrolling, the content stays inside its measured width, and the scrollbar remains a visual affordance rather than a second layout system.',
] as const

const fileRows = [
  'agent-roster-skill-detail-dialog-preview-image.png',
  'workflow-agent-binding-source-of-truth-summary.md',
  'very-long-file-name-that-should-truncate-inside-a-vertical-scroll-area-without-creating-horizontal-scroll.json',
  'runtime-output-schema.ts',
  'knowledge-retrieval-notes.md',
  'composer-draft-original-state-diffing-notes.md',
  'generated-contract-console-query-options.ts',
  'agent-v2-workflow-node-config-schema.json',
  'selected-file-highlight-behavior.spec.tsx',
  'scroll-area-content-min-width-regression.md',
] as const

const gridCells = Array.from({ length: 100 }, (_, index) => index + 1)

function StorySection({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-[28px] border border-divider-subtle bg-background-body p-5',
        className,
      )}
    >
      <div className="space-y-1">
        <div className="system-xs-medium-uppercase text-text-tertiary">{eyebrow}</div>
        <h3 className="system-md-semibold text-text-primary">{title}</h3>
        <p className="max-w-[72ch] system-sm-regular text-pretty text-text-secondary">
          {description}
        </p>
      </div>
      <div className="mt-5 flex justify-center">{children}</div>
    </section>
  )
}

function VerticalContent({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <ScrollAreaContent
      style={verticalContentStyle}
      className={cn('w-full max-w-full min-w-0', className)}
    >
      {children}
    </ScrollAreaContent>
  )
}

export const Anatomy: Story = {
  render: () => (
    <StorySection
      eyebrow="Anatomy"
      title="Base UI compound parts"
      description="The baseline story mirrors the official Scroll Area anatomy: Root, Viewport, Content, Scrollbar, and Thumb, with keyboard focus drawn by the viewport."
    >
      <ScrollAreaRoot className="relative h-75 w-full max-w-105 min-w-0">
        <ScrollAreaViewport
          aria-label="Scrollable anatomy example"
          role="region"
          className="h-full max-h-full max-w-full rounded-xl border-[0.5px] border-divider-subtle bg-components-panel-bg"
        >
          <VerticalContent className="flex flex-col gap-4 py-2 pr-5 pl-3 system-sm-regular leading-6 text-text-secondary">
            {articleParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </VerticalContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </StorySection>
  ),
}

export const Vertical: Story = {
  render: () => (
    <StorySection
      eyebrow="Vertical"
      title="Long form content"
      description="Vertical overflow keeps the official viewport focus pattern while constraining content width so text never leaks outside the frame."
    >
      <ScrollAreaRoot className="relative h-90 w-full max-w-130 min-w-0">
        <ScrollAreaViewport
          aria-label="Long form content"
          role="region"
          className="h-full max-h-full max-w-full rounded-xl border-[0.5px] border-divider-subtle bg-components-panel-bg"
        >
          <VerticalContent className="flex flex-col gap-4 p-4 pr-6 system-sm-regular leading-6 text-text-secondary">
            <div className="space-y-1">
              <div className="system-xs-medium-uppercase text-text-tertiary">Article</div>
              <div className="system-md-semibold text-text-primary">Scrollable text region</div>
            </div>
            {Array.from({ length: 4 }, (_, groupIndex) =>
              articleParagraphs.map((paragraph) => (
                <p key={`${groupIndex}-${paragraph}`}>{paragraph}</p>
              )),
            )}
          </VerticalContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </StorySection>
  ),
}

export const VerticalTruncation: Story = {
  render: () => (
    <StorySection
      eyebrow="Vertical"
      title="Constrained content width"
      description="Use width constraints plus minWidth: 0 on ScrollArea.Content when a vertical-only list should keep vertical scrolling while truncating long labels instead of creating horizontal scroll."
    >
      <ScrollAreaRoot className="relative h-48 w-full max-w-80 min-w-0">
        <ScrollAreaViewport
          aria-label="Vertical file list"
          role="region"
          className="h-full max-h-full max-w-full rounded-xl border-[0.5px] border-divider-subtle bg-components-panel-bg"
        >
          <VerticalContent className="flex flex-col gap-0.5 p-2">
            {fileRows.map((file) => (
              <div
                key={file}
                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-text-secondary hover:bg-state-base-hover"
              >
                <span aria-hidden className="i-ri-file-text-line size-4 shrink-0" />
                <span className="min-w-0 truncate system-sm-regular" title={file}>
                  {file}
                </span>
              </div>
            ))}
          </VerticalContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </StorySection>
  ),
}

export const ScrollFade: Story = {
  render: () => (
    <StorySection
      eyebrow="Fade"
      title="Viewport mask with root focus"
      description="This mirrors the Base UI scroll-fade example: the viewport owns the mask and the root owns the focus outline so the indicator is never clipped."
    >
      <ScrollAreaRoot
        className={cn(
          'relative h-90 w-full max-w-130 min-w-0',
          'has-[>_:first-child:focus-visible]:outline-2 has-[>_:first-child:focus-visible]:outline-offset-0 has-[>_:first-child:focus-visible]:outline-state-accent-solid',
        )}
      >
        <ScrollAreaViewport
          aria-label="Scroll fade article"
          role="region"
          className={cn(
            'h-full max-h-full max-w-full rounded-xl bg-components-panel-bg outline-none focus-visible:outline-none',
            'mask-linear-[to_bottom,transparent_0,black_min(40px,var(--scroll-area-overflow-y-start)),black_calc(100%_-_min(40px,var(--scroll-area-overflow-y-end,40px))),transparent_100%] mask-no-repeat',
          )}
        >
          <VerticalContent className="flex flex-col gap-4 px-4 py-3 pr-6 system-sm-regular leading-6 text-text-secondary">
            {Array.from({ length: 5 }, (_, groupIndex) =>
              articleParagraphs.map((paragraph) => (
                <p key={`${groupIndex}-${paragraph}`}>{paragraph}</p>
              )),
            )}
          </VerticalContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar className="opacity-0 data-hovering:opacity-100 data-scrolling:opacity-100 data-scrolling:duration-0">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </StorySection>
  ),
}

export const Horizontal: Story = {
  render: () => (
    <StorySection
      eyebrow="Horizontal"
      title="Single axis row"
      description="Horizontal overflow keeps Base UI's content sizing behavior and uses the same viewport focus treatment on the scrollable element."
      className="mx-auto max-w-190"
    >
      <ScrollAreaRoot className="relative h-46 w-full max-w-130 min-w-0">
        <ScrollAreaViewport
          aria-label="Horizontal numbered row"
          role="region"
          className="h-full max-h-full max-w-full rounded-xl border-[0.5px] border-divider-subtle bg-components-panel-bg"
        >
          <ScrollAreaContent className="min-h-full min-w-max p-4 pb-6">
            <div className="grid grid-cols-[repeat(18,6.25rem)] gap-3">
              {gridCells.slice(0, 18).map((cell) => (
                <div
                  key={cell}
                  className="flex h-24 items-center justify-center rounded-xl border border-divider-subtle bg-components-panel-bg-alt system-md-semibold text-text-secondary tabular-nums"
                >
                  {cell}
                </div>
              ))}
            </div>
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="horizontal">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </StorySection>
  ),
}

export const BothAxes: Story = {
  render: () => (
    <StorySection
      eyebrow="Both axes"
      title="Numbered grid"
      description="This follows the official two-axis example: both scrollbars are rendered and Corner reserves the intersection."
    >
      <ScrollAreaRoot className="relative h-85 w-full max-w-140 min-w-0">
        <ScrollAreaViewport
          aria-label="Numbered grid"
          role="region"
          className="h-full max-h-full max-w-full rounded-xl border-[0.5px] border-divider-subtle bg-components-panel-bg"
        >
          <ScrollAreaContent className="pt-3 pr-6 pb-6 pl-3">
            <div className="grid grid-cols-[repeat(10,6.25rem)] grid-rows-[repeat(10,6.25rem)] gap-3">
              {gridCells.map((cell) => (
                <div
                  key={cell}
                  className="flex items-center justify-center rounded-lg border border-divider-subtle bg-components-panel-bg-alt system-md-semibold text-text-secondary tabular-nums"
                >
                  {cell}
                </div>
              ))}
            </div>
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
        <ScrollAreaScrollbar orientation="horizontal">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
        <ScrollAreaCorner />
      </ScrollAreaRoot>
    </StorySection>
  ),
}
