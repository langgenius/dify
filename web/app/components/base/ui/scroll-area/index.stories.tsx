import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import AppIcon from '@/app/components/base/app-icon'
import {
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '.'

const meta = {
  title: 'Base/UI/ScrollArea',
  component: ScrollAreaRoot,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Compound scroll container built on Base UI ScrollArea. These stories focus on panel-style compositions that already exist throughout Dify: dense sidebars, sticky list headers, multi-pane workbenches, horizontal rails, and overlay surfaces. Scrollbar placement should be adjusted by consumer spacing classes such as margin-based overrides instead of right/bottom positioning utilities.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ScrollAreaRoot>

export default meta
type Story = StoryObj<typeof meta>

const panelClassName = 'overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg shadow-shadow-shadow-5'
const blurPanelClassName = 'overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl shadow-shadow-shadow-7 backdrop-blur-[6px]'
const labelClassName = 'text-text-tertiary system-xs-medium-uppercase tracking-[0.14em]'
const titleClassName = 'system-sm-semibold text-text-primary'
const bodyClassName = 'system-sm-regular text-text-secondary'
const insetScrollAreaClassName = 'h-full p-1'
const insetViewportClassName = 'rounded-[20px] bg-components-panel-bg'
const insetScrollbarClassName = 'data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1 data-[orientation=horizontal]:mx-1 data-[orientation=horizontal]:mb-1'
const storyButtonClassName = 'flex w-full items-center justify-between gap-3 rounded-xl border border-divider-subtle bg-components-panel-bg-alt px-3 py-2.5 text-left text-text-secondary transition-colors hover:bg-state-base-hover focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-components-input-border-hover motion-reduce:transition-none'
const sidebarScrollAreaClassName = 'h-full'
const sidebarViewportClassName = 'overscroll-contain'
const sidebarContentClassName = 'space-y-0.5'
const sidebarScrollbarClassName = 'data-[orientation=vertical]:my-2 data-[orientation=vertical]:-me-3'
const appNavButtonClassName = 'group flex h-8 w-full items-center justify-between gap-3 rounded-lg px-2 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-components-input-border-hover motion-reduce:transition-none'
const appNavMetaClassName = 'shrink-0 rounded-md border border-divider-subtle bg-components-panel-bg-alt px-1.5 py-0.5 text-text-quaternary system-2xs-medium-uppercase tracking-[0.08em]'

const releaseRows = [
  { title: 'Agent refactor', meta: 'Updated 2 hours ago', status: 'Ready' },
  { title: 'Retriever tuning', meta: 'Updated yesterday', status: 'Review' },
  { title: 'Workflow replay', meta: 'Updated 3 days ago', status: 'Draft' },
  { title: 'Sandbox policy', meta: 'Updated this week', status: 'Ready' },
  { title: 'SSE diagnostics', meta: 'Updated last week', status: 'Blocked' },
  { title: 'Model routing', meta: 'Updated 9 days ago', status: 'Review' },
  { title: 'Chunk overlap', meta: 'Updated 11 days ago', status: 'Draft' },
  { title: 'Vector warmup', meta: 'Updated 2 weeks ago', status: 'Ready' },
] as const

const queueRows = [
  { id: 'PLG-142', title: 'Plugin catalog sync', note: 'Waiting for moderation result' },
  { id: 'OPS-088', title: 'Billing alert fallback', note: 'Last retry finished 12 minutes ago' },
  { id: 'RAG-511', title: 'Embedding migration', note: '16 datasets still pending' },
  { id: 'AGT-204', title: 'Multi-agent tracing', note: 'QA is verifying edge cases' },
  { id: 'UI-390', title: 'Prompt editor polish', note: 'Needs token density pass' },
  { id: 'WEB-072', title: 'Marketplace empty state', note: 'Waiting for design review' },
] as const

const horizontalCards = [
  { title: 'Claude Opus', detail: 'Reasoning-heavy preset' },
  { title: 'GPT-5.4', detail: 'Balanced orchestration lane' },
  { title: 'Gemini 2.5', detail: 'Multimodal fallback' },
  { title: 'Qwen Max', detail: 'Regional deployment' },
  { title: 'DeepSeek R1', detail: 'High-throughput analysis' },
  { title: 'Llama 4', detail: 'Cost-sensitive routing' },
] as const

const activityRows = Array.from({ length: 14 }, (_, index) => ({
  title: `Workspace activity ${index + 1}`,
  body: 'A short line of copy to mimic dense operational feeds in settings and debug panels.',
}))

const scrollbarShowcaseRows = Array.from({ length: 18 }, (_, index) => ({
  title: `Scroll checkpoint ${index + 1}`,
  body: 'Dedicated story content so the scrollbar can be inspected without sticky headers, masks, or clipped shells.',
}))

const horizontalShowcaseCards = Array.from({ length: 8 }, (_, index) => ({
  title: `Lane ${index + 1}`,
  body: 'Horizontal scrollbar reference without edge hints.',
}))

const webAppsRows = [
  { id: 'invoice-copilot', name: 'Invoice Copilot', meta: 'Pinned', icon: '🧾', iconBackground: '#FFEAD5', selected: true, pinned: true },
  { id: 'rag-ops', name: 'RAG Ops Console', meta: 'Ops', icon: '🛰️', iconBackground: '#E0F2FE', selected: false, pinned: true },
  { id: 'knowledge-studio', name: 'Knowledge Studio', meta: 'Docs', icon: '📚', iconBackground: '#FEF3C7', selected: false, pinned: true },
  { id: 'workflow-studio', name: 'Workflow Studio', meta: 'Build', icon: '🧩', iconBackground: '#E0E7FF', selected: false, pinned: true },
  { id: 'growth-briefs', name: 'Growth Briefs', meta: 'Brief', icon: '📣', iconBackground: '#FCE7F3', selected: false, pinned: true },
  { id: 'agent-playground', name: 'Agent Playground', meta: 'Lab', icon: '🧪', iconBackground: '#DCFCE7', selected: false, pinned: false },
  { id: 'sales-briefing', name: 'Sales Briefing', meta: 'Team', icon: '📈', iconBackground: '#FCE7F3', selected: false, pinned: false },
  { id: 'support-triage', name: 'Support Triage', meta: 'Queue', icon: '🎧', iconBackground: '#EDE9FE', selected: false, pinned: false },
  { id: 'legal-review', name: 'Legal Review', meta: 'Beta', icon: '⚖️', iconBackground: '#FDE68A', selected: false, pinned: false },
  { id: 'release-watcher', name: 'Release Watcher', meta: 'Feed', icon: '🚀', iconBackground: '#DBEAFE', selected: false, pinned: false },
  { id: 'research-hub', name: 'Research Hub', meta: 'Notes', icon: '🔎', iconBackground: '#E0F2FE', selected: false, pinned: false },
  { id: 'field-enablement', name: 'Field Enablement', meta: 'Team', icon: '🧭', iconBackground: '#DCFCE7', selected: false, pinned: false },
  { id: 'brand-monitor', name: 'Brand Monitor', meta: 'Watch', icon: '🪄', iconBackground: '#F3E8FF', selected: false, pinned: false },
  { id: 'finance-ops', name: 'Finance Ops Desk', meta: 'Ops', icon: '💳', iconBackground: '#FEF3C7', selected: false, pinned: false },
  { id: 'security-radar', name: 'Security Radar', meta: 'Risk', icon: '🛡️', iconBackground: '#FEE2E2', selected: false, pinned: false },
  { id: 'partner-portal', name: 'Partner Portal', meta: 'Ext', icon: '🤝', iconBackground: '#DBEAFE', selected: false, pinned: false },
  { id: 'qa-replays', name: 'QA Replays', meta: 'Debug', icon: '🎞️', iconBackground: '#EDE9FE', selected: false, pinned: false },
  { id: 'roadmap-notes', name: 'Roadmap Notes', meta: 'Plan', icon: '🗺️', iconBackground: '#FFEAD5', selected: false, pinned: false },
] as const

const StoryCard = ({
  eyebrow,
  title,
  description,
  className,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  className?: string
  children: ReactNode
}) => (
  <section className={cn('min-w-0 rounded-[28px] border border-divider-subtle bg-background-body p-5', className)}>
    <div className="space-y-1">
      <div className={labelClassName}>{eyebrow}</div>
      <h3 className="system-md-semibold text-pretty text-text-primary">{title}</h3>
      <p className="max-w-[72ch] system-sm-regular text-pretty text-text-secondary">{description}</p>
    </div>
    {children}
  </section>
)

const VerticalPanelPane = () => (
  <div className={cn(panelClassName, 'h-[360px]')}>
    <ScrollAreaRoot className={insetScrollAreaClassName}>
      <ScrollAreaViewport className={insetViewportClassName}>
        <ScrollAreaContent className="space-y-3 p-4 pr-6">
          <div className="space-y-1">
            <div className={labelClassName}>Release board</div>
            <div className="system-md-semibold text-text-primary">Weekly checkpoints</div>
            <p className={bodyClassName}>A simple vertical panel with the default scrollbar skin and no business-specific overrides.</p>
          </div>
          {releaseRows.map(item => (
            <article key={item.title} className="rounded-xl border border-divider-subtle bg-components-panel-bg-alt p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h4 className={cn(titleClassName, 'truncate')}>{item.title}</h4>
                  <p className="system-xs-regular text-text-tertiary">{item.meta}</p>
                </div>
                <span className="rounded-full bg-state-base-hover px-2 py-1 system-xs-medium text-text-secondary">
                  {item.status}
                </span>
              </div>
            </article>
          ))}
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar className={insetScrollbarClassName}>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  </div>
)

const StickyListPane = () => (
  <div className={cn(panelClassName, 'h-[360px]')}>
    <ScrollAreaRoot className={insetScrollAreaClassName}>
      <ScrollAreaViewport className={cn(insetViewportClassName, 'mask-[linear-gradient(to_bottom,transparent_0px,black_10px,black_calc(100%-14px),transparent_100%)]')}>
        <ScrollAreaContent className="min-h-full">
          <div className="sticky top-0 z-10 border-b border-divider-subtle bg-components-panel-bg px-4 pt-4 pb-3">
            <div className={labelClassName}>Sticky header</div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <div>
                <div className="system-md-semibold text-text-primary">Operational queue</div>
                <p className="mt-1 system-xs-regular text-text-secondary">The scrollbar is still the shared base/ui primitive, while the pane adds sticky structure and a viewport mask.</p>
              </div>
              <span className="rounded-lg border border-divider-subtle bg-components-panel-bg-alt px-2.5 py-1 system-xs-medium text-text-secondary">
                24 items
              </span>
            </div>
          </div>
          <div className="space-y-2 px-4 py-3 pr-6">
            {queueRows.map(item => (
              <article key={item.id} className="rounded-xl border border-divider-subtle bg-components-panel-bg-alt px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="truncate system-sm-semibold text-text-primary">{item.title}</div>
                    <div className="line-clamp-2 system-xs-regular wrap-break-word text-text-tertiary">{item.note}</div>
                  </div>
                  <span className="system-xs-medium text-text-quaternary">{item.id}</span>
                </div>
              </article>
            ))}
          </div>
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar className={insetScrollbarClassName}>
        <ScrollAreaThumb className="rounded-full" />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  </div>
)

const WorkbenchPane = ({
  title,
  eyebrow,
  children,
  className,
}: {
  title: string
  eyebrow: string
  children: ReactNode
  className?: string
}) => (
  <div className={cn(panelClassName, 'min-h-0', className)}>
    <ScrollAreaRoot className={insetScrollAreaClassName}>
      <ScrollAreaViewport className={insetViewportClassName}>
        <ScrollAreaContent className="space-y-3 p-4 pr-6">
          <div className="space-y-1">
            <div className={labelClassName}>{eyebrow}</div>
            <div className="system-md-semibold text-text-primary">{title}</div>
          </div>
          {children}
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar className={insetScrollbarClassName}>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  </div>
)

const HorizontalRailPane = () => (
  <div className={cn(panelClassName, 'h-[272px] max-w-full min-w-0')}>
    <ScrollAreaRoot className={insetScrollAreaClassName}>
      <ScrollAreaViewport className={insetViewportClassName}>
        <ScrollAreaContent className="min-h-full min-w-max space-y-4 p-4 pb-6">
          <div className="space-y-1">
            <div className={labelClassName}>Horizontal rail</div>
            <div className="system-md-semibold text-text-primary">Model lanes</div>
            <p className={bodyClassName}>This pane keeps the default track behavior and only changes the surface layout around it.</p>
          </div>
          <div className="flex gap-3">
            {horizontalCards.map(card => (
              <article key={card.title} className="flex h-[152px] w-[232px] shrink-0 flex-col justify-between rounded-2xl border border-divider-subtle bg-components-panel-bg-alt p-4">
                <div className="space-y-2">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-state-base-hover text-text-secondary">
                    <span aria-hidden className="i-ri-stack-line size-5" />
                  </span>
                  <div className="system-sm-semibold text-text-primary">{card.title}</div>
                  <div className="system-sm-regular text-text-secondary">{card.detail}</div>
                </div>
                <div className="system-xs-regular text-text-tertiary">Drag cards into orchestration groups.</div>
              </article>
            ))}
          </div>
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="horizontal" className={insetScrollbarClassName}>
        <ScrollAreaThumb className="rounded-full" />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  </div>
)

const ScrollbarStatePane = ({
  eyebrow,
  title,
  description,
  initialPosition,
}: {
  eyebrow: string
  title: string
  description: string
  initialPosition: 'top' | 'middle' | 'bottom'
}) => {
  const viewportId = React.useId()

  React.useEffect(() => {
    let frameA = 0
    let frameB = 0

    const syncScrollPosition = () => {
      const viewport = document.getElementById(viewportId)

      if (!(viewport instanceof HTMLDivElement))
        return

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)

      if (initialPosition === 'top')
        viewport.scrollTop = 0

      if (initialPosition === 'middle')
        viewport.scrollTop = maxScrollTop / 2

      if (initialPosition === 'bottom')
        viewport.scrollTop = maxScrollTop
    }

    frameA = requestAnimationFrame(() => {
      frameB = requestAnimationFrame(syncScrollPosition)
    })

    return () => {
      cancelAnimationFrame(frameA)
      cancelAnimationFrame(frameB)
    }
  }, [initialPosition, viewportId])

  return (
    <div className="min-w-0 rounded-[28px] border border-divider-subtle bg-background-body p-5">
      <div className="space-y-1">
        <div className={labelClassName}>{eyebrow}</div>
        <div className="system-md-semibold text-text-primary">{title}</div>
        <p className="system-sm-regular text-text-secondary">{description}</p>
      </div>
      <div className="mt-4 min-w-0 rounded-[24px] border border-divider-subtle bg-components-panel-bg p-3">
        <ScrollAreaRoot className="h-[320px] p-1">
          <ScrollAreaViewport id={viewportId} className="rounded-[20px] bg-components-panel-bg">
            <ScrollAreaContent className="min-w-0 space-y-2 p-4 pr-6">
              {scrollbarShowcaseRows.map(item => (
                <article key={item.title} className="min-w-0 rounded-xl border border-divider-subtle bg-components-panel-bg-alt p-3">
                  <div className="truncate system-sm-semibold text-text-primary">{item.title}</div>
                  <div className="mt-1 system-sm-regular wrap-break-word text-text-secondary">{item.body}</div>
                </article>
              ))}
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar className={insetScrollbarClassName}>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      </div>
    </div>
  )
}

const HorizontalScrollbarShowcasePane = () => (
  <div className="min-w-0 rounded-[28px] border border-divider-subtle bg-background-body p-5">
    <div className="space-y-1">
      <div className={labelClassName}>Horizontal</div>
      <div className="system-md-semibold text-text-primary">Horizontal track reference</div>
      <p className="system-sm-regular text-text-secondary">Current design delivery defines the horizontal scrollbar body, but not a horizontal edge hint.</p>
    </div>
    <div className="mt-4 min-w-0 rounded-[24px] border border-divider-subtle bg-components-panel-bg p-3">
      <ScrollAreaRoot className="h-[240px] p-1">
        <ScrollAreaViewport className="rounded-[20px] bg-components-panel-bg">
          <ScrollAreaContent className="min-h-full min-w-max space-y-4 p-4 pb-6">
            <div className="space-y-1">
              <div className="system-sm-semibold text-text-primary">Horizontal scrollbar</div>
              <div className="system-sm-regular text-text-secondary">A clean horizontal pane to inspect thickness, padding, and thumb behavior without extra masks.</div>
            </div>
            <div className="flex gap-3">
              {horizontalShowcaseCards.map(card => (
                <article key={card.title} className="flex h-[120px] w-[220px] shrink-0 flex-col justify-between rounded-2xl border border-divider-subtle bg-components-panel-bg-alt p-4">
                  <div className="system-sm-semibold text-text-primary">{card.title}</div>
                  <div className="system-sm-regular text-text-secondary">{card.body}</div>
                </article>
              ))}
            </div>
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="horizontal" className={insetScrollbarClassName}>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </div>
  </div>
)

const OverlayPane = () => (
  <div className="flex h-[420px] min-w-0 items-center justify-center rounded-[28px] bg-[radial-gradient(circle_at_top,rgba(21,90,239,0.12),transparent_45%),linear-gradient(180deg,rgba(16,24,40,0.03),transparent)] p-6">
    <div className={cn(blurPanelClassName, 'w-full max-w-[360px]')}>
      <ScrollAreaRoot className="h-[320px] p-1">
        <ScrollAreaViewport className="overscroll-contain rounded-[20px] bg-components-panel-bg-blur">
          <ScrollAreaContent className="space-y-2 p-3 pr-6">
            <div className="sticky top-0 z-10 rounded-xl border border-divider-subtle bg-components-panel-bg-blur px-3 py-3 backdrop-blur-[6px]">
              <div className={labelClassName}>Overlay palette</div>
              <div className="mt-1 system-md-semibold text-text-primary">Quick actions</div>
            </div>
            {activityRows.map(item => (
              <article key={item.title} className="rounded-xl border border-divider-subtle bg-components-panel-bg px-3 py-3 shadow-sm shadow-shadow-shadow-2">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-state-base-hover text-text-secondary">
                    <span aria-hidden className="i-ri-flashlight-line size-4" />
                  </span>
                  <div className="space-y-1">
                    <div className="system-sm-semibold text-text-primary">{item.title}</div>
                    <div className="system-xs-regular text-text-secondary">{item.body}</div>
                  </div>
                </div>
              </article>
            ))}
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar className={insetScrollbarClassName}>
          <ScrollAreaThumb className="rounded-full bg-state-base-handle hover:bg-state-base-handle-hover" />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </div>
  </div>
)

const CornerPane = () => (
  <div className={cn(panelClassName, 'h-[320px] w-full max-w-[440px]')}>
    <ScrollAreaRoot className={cn(insetScrollAreaClassName, 'overflow-hidden')}>
      <ScrollAreaViewport className={cn(insetViewportClassName, 'bg-[linear-gradient(180deg,var(--color-components-panel-bg),var(--color-components-panel-bg-alt))]')}>
        <ScrollAreaContent className="min-h-[420px] min-w-[620px] space-y-4 p-4">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <div className={labelClassName}>Corner surface</div>
              <div className="system-md-semibold text-text-primary">Bi-directional inspector canvas</div>
              <p className={bodyClassName}>Both axes overflow here so the corner becomes visible as a deliberate seam between the two tracks.</p>
            </div>
            <span className="rounded-full bg-state-base-hover px-2 py-1 system-xs-medium text-text-secondary">
              Always visible
            </span>
          </div>
          <div className="grid min-w-[560px] grid-cols-[220px_repeat(3,180px)] gap-3">
            {Array.from({ length: 12 }, (_, index) => (
              <article key={index} className="rounded-2xl border border-divider-subtle bg-components-panel-bg-alt p-4">
                <div className="system-sm-semibold text-text-primary">
                  Cell
                  {' '}
                  {index + 1}
                </div>
                <p className="mt-2 system-sm-regular text-text-secondary">
                  Wide-and-tall content to force both scrollbars and show the corner treatment clearly.
                </p>
              </article>
            ))}
          </div>
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar className={insetScrollbarClassName}>
        <ScrollAreaThumb className="rounded-full" />
      </ScrollAreaScrollbar>
      <ScrollAreaScrollbar orientation="horizontal" className={insetScrollbarClassName}>
        <ScrollAreaThumb className="rounded-full" />
      </ScrollAreaScrollbar>
      <ScrollAreaCorner className="bg-[linear-gradient(180deg,var(--color-components-panel-bg),var(--color-components-panel-bg-alt))]" />
    </ScrollAreaRoot>
  </div>
)

const ExploreSidebarWebAppsPane = () => {
  const pinnedAppsCount = webAppsRows.filter(item => item.pinned).length

  return (
    <div className="w-full max-w-[272px] rounded-[26px] border border-divider-subtle bg-background-body p-3 shadow-lg shadow-shadow-shadow-5">
      <div className="space-y-5 rounded-[20px] bg-background-default-subtle p-3">
        <div className="text-text-accent">
          <div className="flex h-8 items-center gap-2 rounded-lg bg-state-base-active px-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid">
              <span className="i-ri-apps-fill size-3.5 text-components-avatar-shape-fill-stop-100" />
            </div>
            <div className="min-w-0 truncate system-sm-semibold text-components-menu-item-text-active">
              Explore
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 px-2">
            <p className="min-w-0 system-xs-medium-uppercase text-text-tertiary uppercase">
              Web Apps
            </p>
            <span className="shrink-0 system-xs-medium text-text-quaternary">
              {webAppsRows.length}
            </span>
          </div>

          <div className="h-[304px]">
            <ScrollAreaRoot className={sidebarScrollAreaClassName}>
              <ScrollAreaViewport className={sidebarViewportClassName}>
                <ScrollAreaContent className={sidebarContentClassName}>
                  {webAppsRows.map((item, index) => (
                    <div key={item.id} className="space-y-0.5">
                      <button
                        type="button"
                        className={cn(
                          appNavButtonClassName,
                          item.selected
                            ? 'bg-state-base-active text-components-menu-item-text-active'
                            : 'text-components-menu-item-text hover:bg-state-base-hover hover:text-components-menu-item-text-hover',
                        )}
                      >
                        <div className="flex min-w-0 grow items-center gap-2">
                          <AppIcon
                            size="tiny"
                            iconType="emoji"
                            icon={item.icon}
                            background={item.iconBackground}
                          />
                          <span className="min-w-0 truncate system-sm-regular">
                            {item.name}
                          </span>
                        </div>
                        <span
                          className={cn(
                            appNavMetaClassName,
                            item.selected && 'border-transparent bg-state-accent-hover text-text-accent',
                          )}
                        >
                          {item.meta}
                        </span>
                      </button>
                      {index === pinnedAppsCount - 1 && index !== webAppsRows.length - 1 && (
                        <div className="my-1 h-px bg-divider-subtle" />
                      )}
                    </div>
                  ))}
                </ScrollAreaContent>
              </ScrollAreaViewport>
              <ScrollAreaScrollbar className={sidebarScrollbarClassName}>
                <ScrollAreaThumb className="rounded-full" />
              </ScrollAreaScrollbar>
            </ScrollAreaRoot>
          </div>
        </div>
      </div>
    </div>
  )
}

export const VerticalPanels: Story = {
  render: () => (
    <StoryCard
      eyebrow="Panels"
      title="Default and extended vertical panes"
      description="Two common Dify surfaces: a straightforward content panel using the shipped scrollbar skin, and a denser queue pane that adds sticky structure, a viewport mask, and a slightly inset scrollbar."
    >
      <div className="grid gap-5 xl:grid-cols-2">
        <VerticalPanelPane />
        <StickyListPane />
      </div>
    </StoryCard>
  ),
}

export const ThreePaneWorkbench: Story = {
  render: () => (
    <StoryCard
      eyebrow="Workbench"
      title="Multi-pane composition"
      description="A three-pane arrangement that mirrors settings and workflow layouts. Each pane uses the same base compound API, but the surfaces and content density differ."
    >
      <div className="grid h-[520px] gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <WorkbenchPane title="Collections" eyebrow="Left rail">
          <div className="space-y-2">
            {releaseRows.map(item => (
              <button key={item.title} type="button" className={storyButtonClassName}>
                <span className="min-w-0 truncate system-sm-medium">{item.title}</span>
                <span className="system-xs-medium text-text-quaternary">{item.status}</span>
              </button>
            ))}
          </div>
        </WorkbenchPane>
        <WorkbenchPane title="Pipeline detail" eyebrow="Center pane" className="bg-[linear-gradient(180deg,var(--color-components-panel-bg),var(--color-components-panel-bg-alt))]">
          <div className="space-y-4">
            {Array.from({ length: 7 }, (_, index) => (
              <section key={index} className="rounded-2xl border border-divider-subtle bg-components-panel-bg-alt p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="system-sm-semibold text-text-primary">
                    Section
                    {' '}
                    {index + 1}
                  </div>
                  <span className="rounded-full bg-state-base-hover px-2 py-1 system-xs-medium text-text-secondary">
                    Active
                  </span>
                </div>
                <p className="mt-2 system-sm-regular text-text-secondary">
                  This pane is intentionally long so the default vertical scrollbar sits over a larger editorial surface.
                </p>
              </section>
            ))}
          </div>
        </WorkbenchPane>
        <WorkbenchPane title="Inspector" eyebrow="Right rail">
          <div className="space-y-3">
            {queueRows.map(item => (
              <article key={item.id} className="rounded-xl border border-divider-subtle bg-components-panel-bg-alt p-3">
                <div className="system-sm-semibold text-text-primary">{item.id}</div>
                <div className="mt-1 system-sm-regular text-text-secondary">{item.title}</div>
                <div className="mt-2 system-xs-regular text-text-tertiary">{item.note}</div>
              </article>
            ))}
          </div>
        </WorkbenchPane>
      </div>
    </StoryCard>
  ),
}

export const HorizontalAndOverlay: Story = {
  render: () => (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <StoryCard
        eyebrow="Horizontal"
        title="Scrollable rails"
        description="A horizontal lane with cards wider than the viewport. The story keeps the shared base scrollbar and only shifts its placement slightly for a cleaner presentation."
      >
        <HorizontalRailPane />
      </StoryCard>
      <StoryCard
        eyebrow="Overlay"
        title="Popup and blurred surfaces"
        description="An overlay-style surface that mirrors menus, pickers, and sidecar drawers already present in the app. The business layer only adjusts the shell and thumb rounding."
      >
        <OverlayPane />
      </StoryCard>
    </div>
  ),
}

export const CornerSurface: Story = {
  render: () => (
    <StoryCard
      eyebrow="Corner"
      title="Explicit corner treatment"
      description="This example keeps both tracks visible so the bottom-right corner can be inspected as part of the surface design, not as an accidental leftover."
    >
      <div className="flex justify-center">
        <CornerPane />
      </div>
    </StoryCard>
  ),
}

export const ExploreSidebarWebApps: Story = {
  render: () => (
    <StoryCard
      eyebrow="Explore"
      title="Web apps sidebar list"
      description="A sidebar-style pane modeled after /explore/apps. The story keeps the shared ScrollArea primitive and composes the surrounding shell, section label, selected state, and pinned divider at the story layer."
    >
      <div className="flex justify-center">
        <ExploreSidebarWebAppsPane />
      </div>
    </StoryCard>
  ),
}

export const PrimitiveComposition: Story = {
  render: () => (
    <StoryCard
      eyebrow="Primitive"
      title="Minimal composition reference"
      description="A stripped-down example for teams that want to start from the base API and add their own shell classes around it. The outer shell adds inset padding so the tracks sit inside the rounded-sm surface instead of colliding with the panel corners."
    >
      <div className={cn(panelClassName, 'h-[260px] max-w-[420px]')}>
        <ScrollAreaRoot className={insetScrollAreaClassName}>
          <ScrollAreaViewport className={insetViewportClassName}>
            <ScrollAreaContent className="min-w-[560px] space-y-3 p-4 pr-6">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="rounded-xl border border-divider-subtle bg-components-panel-bg-alt px-3 py-3 system-sm-regular text-text-secondary">
                  Primitive row
                  {' '}
                  {index + 1}
                </div>
              ))}
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar className={insetScrollbarClassName}>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
          <ScrollAreaScrollbar orientation="horizontal" className={insetScrollbarClassName}>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
          <ScrollAreaCorner />
        </ScrollAreaRoot>
      </div>
    </StoryCard>
  ),
}

export const ScrollbarDelivery: Story = {
  render: () => (
    <StoryCard
      eyebrow="Scrollbar"
      title="Dedicated scrollbar delivery review"
      description="Three vertical panes pin the viewport to top, middle, and bottom so the edge hint can be inspected without sticky headers, viewport masks, or clipped shells. A separate horizontal pane shows the current non-edge-hint track."
    >
      <div className="grid gap-5 xl:grid-cols-2">
        <ScrollbarStatePane
          eyebrow="Top"
          title="At top edge"
          description="Top edge hint should sit exactly on the handle area edge."
          initialPosition="top"
        />
        <ScrollbarStatePane
          eyebrow="Middle"
          title="Away from edges"
          description="No edge hint should be visible when the viewport is not pinned to either end."
          initialPosition="middle"
        />
        <ScrollbarStatePane
          eyebrow="Bottom"
          title="At bottom edge"
          description="Bottom edge hint should sit exactly on the handle area edge."
          initialPosition="bottom"
        />
        <HorizontalScrollbarShowcasePane />
      </div>
    </StoryCard>
  ),
}
