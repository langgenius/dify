import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
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
        component: 'Compound scroll container built on Base UI Scroll Area. The examples mirror the upstream anatomy and focus patterns while applying Dify UI tokens, panel surfaces, and scrollbar spacing.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ScrollAreaRoot>

export default meta
type Story = StoryObj<typeof meta>

const scrollFadeRootClassName = cn(
  'has-[>_:first-child:focus-visible]:outline-2',
  'has-[>_:first-child:focus-visible]:outline-offset-0',
  'has-[>_:first-child:focus-visible]:outline-state-accent-solid',
)
const rootClassName = 'relative min-h-0 min-w-0'
const viewportClassName = 'h-full max-h-full max-w-full rounded-xl border border-divider-subtle bg-components-panel-bg'
const fadeViewportClassName = cn(
  'h-full max-h-full max-w-full rounded-xl bg-components-panel-bg outline-none focus-visible:outline-none',
  'mask-linear-[to_bottom,transparent_0,black_min(40px,var(--scroll-area-overflow-y-start)),black_calc(100%_-_min(40px,var(--scroll-area-overflow-y-end,40px))),transparent_100%] mask-no-repeat',
)
const scrollbarClassName = cn(
  'data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1',
  'data-[orientation=horizontal]:mx-1 data-[orientation=horizontal]:mb-1',
)
const verticalContentClassName = 'w-full max-w-full min-w-0'
const verticalContentStyle = { minWidth: 0 } satisfies React.CSSProperties
const panelClassName = 'min-w-0 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg shadow-shadow-shadow-5'
const pageClassName = 'min-w-0 rounded-[28px] border border-divider-subtle bg-background-body p-5'
const labelClassName = 'system-xs-medium-uppercase text-text-tertiary'
const headingClassName = 'system-md-semibold text-text-primary'

const appRows = [
  { name: 'Invoice Copilot', meta: 'Pinned', icon: 'i-ri-file-list-3-line', selected: true, pinned: true },
  { name: 'RAG Ops Console', meta: 'Ops', icon: 'i-ri-database-2-line', selected: false, pinned: true },
  { name: 'Knowledge Studio', meta: 'Docs', icon: 'i-ri-book-open-line', selected: false, pinned: true },
  { name: 'Workflow Studio', meta: 'Build', icon: 'i-ri-flow-chart', selected: false, pinned: true },
  { name: 'Agent Playground', meta: 'Lab', icon: 'i-ri-robot-2-line', selected: false, pinned: false },
  { name: 'Sales Briefing', meta: 'Team', icon: 'i-ri-presentation-line', selected: false, pinned: false },
  { name: 'Support Triage', meta: 'Queue', icon: 'i-ri-customer-service-2-line', selected: false, pinned: false },
  { name: 'Legal Review', meta: 'Beta', icon: 'i-ri-scales-3-line', selected: false, pinned: false },
  { name: 'Release Watcher', meta: 'Feed', icon: 'i-ri-rocket-line', selected: false, pinned: false },
  { name: 'Security Radar', meta: 'Risk', icon: 'i-ri-shield-check-line', selected: false, pinned: false },
  { name: 'Partner Portal', meta: 'Ext', icon: 'i-ri-handshake-line', selected: false, pinned: false },
  { name: 'QA Replays', meta: 'Debug', icon: 'i-ri-replay-line', selected: false, pinned: false },
] as const

const articleParagraphs = [
  'Vernacular architecture is building done outside any academic tradition, and without professional guidance. It is not a particular architectural movement or style, but rather a broad category, encompassing a wide range and variety of building types, with differing methods of construction, from around the world, both historical and extant and classical and modern.',
  'This type of architecture usually serves immediate, local needs, is constrained by the materials available in its particular region, and reflects local traditions and cultural practices. The study of vernacular architecture does not examine formally schooled architects, but instead the design skills and tradition of local builders.',
  'A scroll area follows the same principle in an interface. The viewport owns scrolling, the content stays inside its measured width, and the scrollbar remains a visual affordance rather than a second layout system.',
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
    <section className={cn(pageClassName, className)}>
      <div className="space-y-1">
        <div className={labelClassName}>{eyebrow}</div>
        <h3 className={headingClassName}>{title}</h3>
        <p className="max-w-[72ch] text-pretty system-sm-regular text-text-secondary">{description}</p>
      </div>
      <div className="mt-5 flex justify-center">
        {children}
      </div>
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
      className={cn(verticalContentClassName, className)}
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
      <div className={cn(panelClassName, 'h-75 w-full max-w-105')}>
        <ScrollAreaRoot className={cn(rootClassName, 'h-full p-1')}>
          <ScrollAreaViewport aria-label="Scrollable anatomy example" role="region" className={viewportClassName}>
            <VerticalContent className="flex flex-col gap-4 py-2 pl-3 pr-5 text-text-secondary system-sm-regular leading-6">
              {articleParagraphs.map(paragraph => (
                <p key={paragraph}>
                  {paragraph}
                </p>
              ))}
            </VerticalContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar className={scrollbarClassName}>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      </div>
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
      <div className={cn(panelClassName, 'h-90 w-full max-w-130')}>
        <ScrollAreaRoot className={cn(rootClassName, 'h-full p-1')}>
          <ScrollAreaViewport aria-label="Long form content" role="region" className={viewportClassName}>
            <VerticalContent className="flex flex-col gap-4 p-4 pr-6 text-text-secondary system-sm-regular leading-6">
              <div className="space-y-1">
                <div className={labelClassName}>Article</div>
                <div className={headingClassName}>Scrollable text region</div>
              </div>
              {Array.from({ length: 4 }, (_, groupIndex) => (
                articleParagraphs.map(paragraph => (
                  <p key={`${groupIndex}-${paragraph}`}>
                    {paragraph}
                  </p>
                ))
              ))}
            </VerticalContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar className={scrollbarClassName}>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      </div>
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
      <div className={cn(panelClassName, 'h-90 w-full max-w-130')}>
        <ScrollAreaRoot className={cn(rootClassName, scrollFadeRootClassName, 'h-full p-1')}>
          <ScrollAreaViewport aria-label="Scroll fade article" role="region" className={fadeViewportClassName}>
            <VerticalContent className="flex flex-col gap-4 px-4 py-3 pr-6 text-text-secondary system-sm-regular leading-6">
              {Array.from({ length: 5 }, (_, groupIndex) => (
                articleParagraphs.map(paragraph => (
                  <p key={`${groupIndex}-${paragraph}`}>
                    {paragraph}
                  </p>
                ))
              ))}
            </VerticalContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar className={scrollbarClassName}>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      </div>
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
      <div className={cn(panelClassName, 'h-46 w-full max-w-130')}>
        <ScrollAreaRoot className={cn(rootClassName, 'h-full p-1')}>
          <ScrollAreaViewport aria-label="Horizontal numbered row" role="region" className={viewportClassName}>
            <ScrollAreaContent className="min-h-full min-w-max p-4 pb-6">
              <div className="grid grid-cols-[repeat(18,6.25rem)] gap-3">
                {gridCells.slice(0, 18).map(cell => (
                  <div key={cell} className="flex h-24 items-center justify-center rounded-xl border border-divider-subtle bg-components-panel-bg-alt tabular-nums system-md-semibold text-text-secondary">
                    {cell}
                  </div>
                ))}
              </div>
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar orientation="horizontal" className={scrollbarClassName}>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      </div>
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
      <div className={cn(panelClassName, 'h-85 w-full max-w-140')}>
        <ScrollAreaRoot className={cn(rootClassName, 'h-full p-1')}>
          <ScrollAreaViewport aria-label="Numbered grid" role="region" className={viewportClassName}>
            <ScrollAreaContent className="pt-3 pr-6 pb-6 pl-3">
              <div className="grid grid-cols-[repeat(10,6.25rem)] grid-rows-[repeat(10,6.25rem)] gap-3">
                {gridCells.map(cell => (
                  <div key={cell} className="flex items-center justify-center rounded-lg border border-divider-subtle bg-components-panel-bg-alt tabular-nums system-md-semibold text-text-secondary">
                    {cell}
                  </div>
                ))}
              </div>
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar className={scrollbarClassName}>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
          <ScrollAreaScrollbar orientation="horizontal" className={scrollbarClassName}>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
          <ScrollAreaCorner />
        </ScrollAreaRoot>
      </div>
    </StorySection>
  ),
}

export const AppSidebar: Story = {
  render: () => {
    const pinnedCount = appRows.filter(row => row.pinned).length

    return (
      <StorySection
        eyebrow="Application"
        title="Main navigation list"
        description="A Dify-like sidebar keeps business UI outside the primitive while preserving the same Root, Viewport, Content, Scrollbar anatomy."
      >
        <div className="w-full max-w-70 rounded-2xl border border-divider-subtle bg-background-body p-3 shadow-lg shadow-shadow-shadow-5">
          <div className="rounded-xl bg-background-default-subtle p-3">
            <div className="mb-4 flex h-8 items-center gap-2 rounded-lg bg-state-base-active px-2 text-text-accent">
              <span className="i-ri-apps-fill size-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate system-sm-semibold">Explore</span>
            </div>
            <div className="mb-1.5 flex items-center justify-between px-2">
              <span className={labelClassName}>Web apps</span>
              <span className="system-xs-medium text-text-quaternary">{appRows.length}</span>
            </div>
            <div className="h-76 min-h-0">
              <ScrollAreaRoot className={cn(rootClassName, 'h-full')}>
                <ScrollAreaViewport aria-label="Web apps" role="region" className="h-full max-h-full max-w-full rounded-lg bg-transparent">
                  <VerticalContent className="space-y-0.5">
                    {appRows.map((row, index) => (
                      <div key={row.name} className="space-y-0.5">
                        <button
                          type="button"
                          className={cn(
                            'flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-2 text-left transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-solid focus-visible:outline-state-accent-solid',
                            row.selected
                              ? 'bg-state-base-active text-components-menu-item-text-active'
                              : 'text-components-menu-item-text hover:bg-state-base-hover hover:text-components-menu-item-text-hover',
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid text-components-avatar-shape-fill-stop-100">
                              <span aria-hidden className={cn(row.icon, 'size-3.5')} />
                            </span>
                            <span className="min-w-0 truncate system-sm-regular">{row.name}</span>
                          </span>
                          <span className="shrink-0 rounded-md border border-divider-subtle bg-components-panel-bg-alt px-1.5 py-0.5 system-2xs-medium-uppercase text-text-quaternary">
                            {row.meta}
                          </span>
                        </button>
                        {index === pinnedCount - 1 && index !== appRows.length - 1 && (
                          <div className="my-1 h-px bg-divider-subtle" />
                        )}
                      </div>
                    ))}
                  </VerticalContent>
                </ScrollAreaViewport>
                <ScrollAreaScrollbar className="data-[orientation=vertical]:my-2 data-[orientation=vertical]:me-1">
                  <ScrollAreaThumb />
                </ScrollAreaScrollbar>
              </ScrollAreaRoot>
            </div>
          </div>
        </div>
      </StorySection>
    )
  },
}
