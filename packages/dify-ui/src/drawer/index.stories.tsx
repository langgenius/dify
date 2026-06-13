import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DrawerRootSnapPoint } from '.'
import * as React from 'react'
import {
  createDrawerHandle,
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerIndent,
  DrawerIndentBackground,
  DrawerPopup,
  DrawerPortal,
  DrawerProvider,
  DrawerSwipeArea,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
} from '.'
import { Button } from '../button'
import { cn } from '../cn'
import { Input } from '../input'
import { ScrollArea } from '../scroll-area'

const triggerButtonClassName = 'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
const textCloseClassName = 'inline-flex h-8 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3.5 text-[13px] font-medium text-components-button-secondary-text shadow-xs outline-hidden hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
const primaryCloseClassName = 'inline-flex h-8 items-center justify-center rounded-lg border-components-button-primary-border bg-components-button-primary-bg px-3.5 text-[13px] font-medium text-components-button-primary-text shadow outline-hidden hover:border-components-button-primary-border-hover hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
const destructiveCloseClassName = 'inline-flex h-8 items-center justify-center rounded-lg border-components-button-destructive-secondary-border bg-components-button-destructive-secondary-bg px-3.5 text-[13px] font-medium text-components-button-destructive-secondary-text outline-hidden hover:border-components-button-destructive-secondary-border-hover hover:bg-components-button-destructive-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
const handleClassName = 'mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-state-base-handle'

const meta = {
  title: 'Base/UI/Drawer',
  component: Drawer,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound drawer built on Base UI Drawer. Use it for side panels, bottom sheets, nested editor panels, snap-point sheets, and mobile navigation surfaces that need swipe gestures. If the panel only needs modal focus management without gestures, use Dialog instead.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Drawer>

export default meta
type Story = StoryObj<typeof meta>

type DrawerFrameProps = {
  title: string
  description: string
  children?: React.ReactNode
  footer?: React.ReactNode
  showHandle?: boolean
  titleId?: string
  contentClassName?: string
}

function DrawerFrame({
  title,
  description,
  children,
  footer,
  showHandle,
  titleId,
  contentClassName,
}: DrawerFrameProps) {
  return (
    <DrawerContent className={cn('flex min-h-0 flex-1 flex-col p-0 pb-0', contentClassName)}>
      {showHandle && <div className={handleClassName} />}
      <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
        <div className="min-w-0">
          <DrawerTitle id={titleId} className="text-lg/6 font-semibold text-text-primary">
            {title}
          </DrawerTitle>
          <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
            {description}
          </DrawerDescription>
        </div>
        <DrawerCloseButton className="shrink-0" />
      </div>
      {children && (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {children}
        </div>
      )}
      {footer && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
          {footer}
        </div>
      )}
    </DrawerContent>
  )
}

function DrawerParts({
  children,
  popupClassName,
  backdropClassName,
}: {
  children: React.ReactNode
  popupClassName?: string
  backdropClassName?: string
}) {
  return (
    <DrawerPortal>
      <DrawerBackdrop className={cn('fixed', backdropClassName)} />
      <DrawerViewport>
        <DrawerPopup className={popupClassName}>
          {children}
        </DrawerPopup>
      </DrawerViewport>
    </DrawerPortal>
  )
}

const settingRows = [
  ['Production model', 'gpt-4.1'],
  ['Retrieval source', 'Customer knowledge base'],
  ['Response mode', 'Streaming'],
] as const

export const Default: Story = {
  render: () => (
    <Drawer swipeDirection="right">
      <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Open drawer
      </DrawerTrigger>
      <DrawerParts>
        <DrawerFrame
          title="Workspace settings"
          description="Review the key runtime defaults for this workspace."
          footer={(
            <>
              <DrawerClose className={textCloseClassName}>Cancel</DrawerClose>
              <DrawerClose className={primaryCloseClassName}>Save changes</DrawerClose>
            </>
          )}
        >
          <div className="grid gap-3">
            {settingRows.map(([label, value]) => (
              <div key={label} className="rounded-xl border-[0.5px] border-divider-subtle bg-background-section-burn p-3">
                <div className="text-xs font-medium text-text-tertiary">{label}</div>
                <div className="mt-1 text-sm font-medium text-text-secondary">{value}</div>
              </div>
            ))}
          </div>
        </DrawerFrame>
      </DrawerParts>
    </Drawer>
  ),
}

function ControlledDemo() {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="flex flex-col items-center gap-3">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open controlled drawer
      </Button>
      <span className="text-xs text-text-tertiary">
        State:
        {' '}
        {open ? 'open' : 'closed'}
      </span>
      <Drawer open={open} onOpenChange={setOpen} swipeDirection="right">
        <DrawerParts popupClassName="data-[swipe-direction=right]:max-w-[420px]">
          <DrawerFrame
            title="Controlled drawer"
            description="Use open and onOpenChange when the owning feature needs to react to close events."
            footer={(
              <>
                <DrawerClose className={textCloseClassName}>Dismiss</DrawerClose>
                <DrawerClose className={primaryCloseClassName}>Done</DrawerClose>
              </>
            )}
          >
            <label className="grid gap-1 text-sm font-medium text-text-secondary" htmlFor="controlled-workspace-name">
              Workspace name
              <Input id="controlled-workspace-name" defaultValue="Acme workspace" autoComplete="organization" />
            </label>
          </DrawerFrame>
        </DrawerParts>
      </Drawer>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}

const directions = [
  { value: 'right', label: 'Right panel' },
  { value: 'left', label: 'Left panel' },
  { value: 'down', label: 'Bottom sheet' },
  { value: 'up', label: 'Top sheet' },
] as const

function PositionDrawer({ direction, label }: {
  direction: typeof directions[number]['value']
  label: string
}) {
  return (
    <Drawer swipeDirection={direction}>
      <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
        {label}
      </DrawerTrigger>
      <DrawerParts popupClassName="data-[swipe-direction=down]:max-h-[80dvh] data-[swipe-direction=up]:max-h-[80dvh]">
        <DrawerFrame
          showHandle={direction === 'down' || direction === 'up'}
          title={label}
          description={`This drawer is positioned with swipeDirection="${direction}" and the Dify default popup styles.`}
          footer={<DrawerClose className={primaryCloseClassName}>Close</DrawerClose>}
        >
          <div className="rounded-xl border-[0.5px] border-divider-subtle bg-components-panel-bg-alt p-4 text-sm/5 text-text-secondary">
            Position is controlled by Base UI data attributes and the drawer popup classes, not by a separate wrapper component.
          </div>
        </DrawerFrame>
      </DrawerParts>
    </Drawer>
  )
}

export const Positions: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-3">
      {directions.map(item => (
        <PositionDrawer key={item.value} direction={item.value} label={item.label} />
      ))}
    </div>
  ),
}

const snapTopMarginRem = 1
const visibleSnapPointRem = 30
const initialSnapPoint: DrawerRootSnapPoint = `${visibleSnapPointRem + snapTopMarginRem}rem`
const snapPoints = [initialSnapPoint, 1] satisfies DrawerRootSnapPoint[]

function SnapPointsDemo() {
  const [snapPoint, setSnapPoint] = React.useState<DrawerRootSnapPoint | null>(initialSnapPoint)

  return (
    <Drawer
      snapPoints={snapPoints}
      snapPoint={snapPoint}
      onSnapPointChange={setSnapPoint}
      snapToSequentialPoints
    >
      <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Open snap drawer
      </DrawerTrigger>
      <DrawerPortal>
        <DrawerBackdrop className="fixed" />
        <DrawerViewport className="flex touch-none items-end justify-center">
          <DrawerPopup
            className={cn(
              'relative overflow-visible! touch-none',
              '[--bleed:3rem] [--top-margin:1rem]',
              '[padding-bottom:max(0px,calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]',
              'after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[var(--bleed)] after:bg-[inherit] after:content-[""]',
              'data-[swipe-direction=down]:max-h-[calc(100dvh-var(--top-margin))]',
              'data-starting-style:[padding-bottom:0] data-ending-style:[padding-bottom:0]',
            )}
          >
            <div className="shrink-0 touch-none border-b-[0.5px] border-divider-subtle px-6 pt-3.5 pb-4">
              <div className="mx-auto mb-2.5 h-1 w-10 shrink-0 rounded-full bg-state-base-handle" />
              <DrawerTitle className="cursor-default text-center text-lg/6 font-semibold text-text-primary">
                Snap points
              </DrawerTitle>
            </div>
            <DrawerContent className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain px-6 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0))]">
              <div className="mx-auto w-full max-w-90">
                <DrawerDescription className="mb-4 text-center text-sm/5 text-text-tertiary">
                  Drag the sheet to snap between a compact peek and a near full-height view.
                </DrawerDescription>
                <div className="mb-4 flex items-center justify-between rounded-xl bg-background-section-burn px-3 py-2 text-xs text-text-tertiary">
                  <span>Current snap point</span>
                  <span className="font-medium text-text-secondary">{String(snapPoint)}</span>
                </div>
                <div className="mb-6 grid gap-2" aria-hidden>
                  {Array.from({ length: 20 }, (_, index) => (
                    <div key={index} className="flex h-12 items-center gap-3 rounded-xl border-[0.5px] border-divider-subtle bg-components-panel-bg-alt px-3">
                      <span className="flex size-7 items-center justify-center rounded-lg bg-state-base-hover text-xs font-medium text-text-secondary">
                        {index + 1}
                      </span>
                      <div className="h-2 min-w-0 flex-1 rounded-full bg-state-base-hover" />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <DrawerClose className={primaryCloseClassName}>Close</DrawerClose>
                </div>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}

export const SnapPoints: Story = {
  render: () => <SnapPointsDemo />,
}

const nestedPopupClassName = cn(
  'data-[swipe-direction=down]:max-h-[82dvh]',
  'data-nested-drawer-open:overflow-hidden data-nested-drawer-open:shadow-md',
  'data-nested-drawer-open:[filter:brightness(0.96)]',
)

export const NestedDrawers: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Open drawer stack
      </DrawerTrigger>
      <DrawerParts popupClassName={nestedPopupClassName}>
        <DrawerFrame
          showHandle
          title="Account"
          description="Open nested drawers from inside a drawer while the parent remains in the stack."
          footer={(
            <>
              <Drawer>
                <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
                  Security settings
                </DrawerTrigger>
                <DrawerParts popupClassName={nestedPopupClassName}>
                  <DrawerFrame
                    showHandle
                    title="Security"
                    description="Nested drawers keep their own title, close button, and focus scope."
                    footer={(
                      <>
                        <Drawer>
                          <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
                            Advanced options
                          </DrawerTrigger>
                          <DrawerParts popupClassName={nestedPopupClassName}>
                            <DrawerFrame
                              showHandle
                              title="Advanced"
                              description="The stack uses Base UI nested drawer data attributes for visual treatment."
                              footer={<DrawerClose className={primaryCloseClassName}>Done</DrawerClose>}
                            >
                              <label className="grid gap-1 text-sm font-medium text-text-secondary" htmlFor="device-name">
                                Device name
                                <Input id="device-name" defaultValue="Personal laptop" />
                              </label>
                            </DrawerFrame>
                          </DrawerParts>
                        </Drawer>
                        <DrawerClose className={textCloseClassName}>Close security</DrawerClose>
                      </>
                    )}
                  >
                    <ul className="grid gap-2 text-sm text-text-secondary">
                      <li className="rounded-xl bg-background-section-burn p-3">Passkeys enabled</li>
                      <li className="rounded-xl bg-background-section-burn p-3">2FA via authenticator app</li>
                      <li className="rounded-xl bg-background-section-burn p-3">3 signed-in devices</li>
                    </ul>
                  </DrawerFrame>
                </DrawerParts>
              </Drawer>
              <DrawerClose className={textCloseClassName}>Close</DrawerClose>
            </>
          )}
        />
      </DrawerParts>
    </Drawer>
  ),
}

function IndentEffectDemo() {
  const [portalContainer, setPortalContainer] = React.useState<HTMLDivElement | null>(null)

  return (
    <DrawerProvider>
      <div ref={setPortalContainer} className="relative h-[420px] w-[640px] overflow-hidden rounded-2xl border-[0.5px] border-divider-subtle bg-background-default">
        <DrawerIndentBackground className="absolute inset-0 bg-state-accent-hover opacity-0 transition-opacity duration-200 data-active:opacity-100" />
        <DrawerIndent className="relative flex size-full flex-col items-center justify-center gap-4 bg-background-body transition-[border-radius,transform] duration-200 data-active:scale-[0.96] data-active:rounded-[20px]">
          <div className="grid max-w-sm gap-2 text-center">
            <h3 className="text-lg font-semibold text-text-primary">Indent provider surface</h3>
            <p className="text-sm text-text-tertiary">
              The background and app shell respond when any drawer inside the provider opens.
            </p>
          </div>
          <Drawer modal={false}>
            <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
              Open indent drawer
            </DrawerTrigger>
            <DrawerPortal container={portalContainer}>
              <DrawerBackdrop />
              <DrawerViewport className="absolute">
                <DrawerPopup className="absolute">
                  <DrawerFrame
                    showHandle
                    title="Notifications"
                    description="The indented shell uses DrawerProvider, DrawerIndentBackground, and DrawerIndent."
                    footer={<DrawerClose className={primaryCloseClassName}>Close</DrawerClose>}
                  />
                </DrawerPopup>
              </DrawerViewport>
            </DrawerPortal>
          </Drawer>
        </DrawerIndent>
      </div>
    </DrawerProvider>
  )
}

export const IndentEffect: Story = {
  parameters: {
    layout: 'centered',
  },
  render: () => <IndentEffectDemo />,
}

function NonModalDemo() {
  const [backgroundClicks, setBackgroundClicks] = React.useState(0)

  return (
    <Drawer swipeDirection="right" modal={false} disablePointerDismissal>
      <div className="flex flex-col items-center gap-3">
        <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
          Open non-modal drawer
        </DrawerTrigger>
        <Button variant="secondary" onClick={() => setBackgroundClicks(count => count + 1)}>
          Background action
        </Button>
        <span className="text-xs text-text-tertiary">
          Background clicks:
          {' '}
          {backgroundClicks}
        </span>
      </div>
      <DrawerPortal>
        <DrawerViewport className="pointer-events-none">
          <DrawerPopup className="pointer-events-auto touch-auto data-[swipe-direction=right]:right-3 data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:bottom-3 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:max-w-[420px] data-[swipe-direction=right]:rounded-2xl data-[swipe-direction=right]:border-r-[0.5px]">
            <DrawerFrame
              title="Non-modal drawer"
              description="Focus is not trapped and outside pointer dismissal is disabled."
              footer={<DrawerClose className={primaryCloseClassName}>Close</DrawerClose>}
            >
              <div className="rounded-xl border-[0.5px] border-divider-subtle bg-background-section-burn p-3 text-sm/5 text-text-secondary">
                The background action remains clickable while this drawer is open. Outside clicks do not dismiss it.
              </div>
            </DrawerFrame>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}

export const NonModal: Story = {
  render: () => <NonModalDemo />,
}

const navItems = ['Explore', 'Apps', 'Datasets', 'Workflows'] as const
const componentItems = [
  'Autocomplete',
  'Button',
  'Combobox',
  'Dialog',
  'Drawer',
  'Field',
  'Form',
  'Popover',
  'Select',
  'Tabs',
  'Tooltip',
  'Toast',
] as const

export const MobileNavigation: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Open mobile menu
      </DrawerTrigger>
      <DrawerParts popupClassName="data-[swipe-direction=down]:max-h-[92dvh]">
        <nav aria-label="Mobile navigation" className="flex min-h-0 flex-1 flex-col">
          <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
            <div className={handleClassName} />
            <div className="flex items-center justify-between px-6 py-4">
              <DrawerTitle className="text-lg/6 font-semibold text-text-primary">Menu</DrawerTitle>
              <DrawerCloseButton aria-label="Close menu" />
            </div>
            <DrawerDescription className="sr-only">
              Scroll the navigation list and swipe down from the top to dismiss.
            </DrawerDescription>
            <ScrollArea className="min-h-0 flex-1" label="Navigation links" slotClassNames={{ content: 'min-w-0 px-6 pb-6' }}>
              <ul className="grid gap-2">
                {navItems.map(item => (
                  <li key={item}>
                    <a href="#" className="flex h-10 items-center rounded-xl px-3 text-sm font-medium text-text-secondary hover:bg-state-base-hover">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-5 text-xs font-medium text-text-tertiary">Components</div>
              <ul className="mt-2 grid gap-1">
                {componentItems.map(item => (
                  <li key={item}>
                    <a href="#" className="flex h-9 items-center rounded-lg px-3 text-sm text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </DrawerContent>
        </nav>
      </DrawerParts>
    </Drawer>
  ),
}

function SwipeToOpenDemo() {
  const [portalContainer, setPortalContainer] = React.useState<HTMLDivElement | null>(null)

  return (
    <div ref={setPortalContainer} className="relative h-[360px] w-[560px] overflow-hidden rounded-2xl border-[0.5px] border-divider-subtle bg-background-body">
      <Drawer swipeDirection="right" modal={false}>
        <DrawerSwipeArea className="absolute inset-y-0 right-0 z-10 flex w-10 touch-none items-center justify-center bg-state-accent-hover text-text-accent">
          <span className="rotate-90 text-xs font-medium">Swipe</span>
        </DrawerSwipeArea>
        <div className="flex size-full items-center justify-center px-8 text-center">
          <div className="grid gap-2">
            <div className="text-lg font-semibold text-text-primary">Swipe area</div>
            <div className="text-sm text-text-tertiary">Drag from the highlighted right edge to open the drawer.</div>
          </div>
        </div>
        <DrawerPortal container={portalContainer}>
          <DrawerBackdrop className="absolute" />
          <DrawerViewport className="absolute">
            <DrawerPopup className="absolute data-[swipe-direction=right]:max-w-[360px]">
              <DrawerFrame
                title="Library"
                description="Swipe from the edge whenever you want to jump back into a panel."
                footer={<DrawerClose className={primaryCloseClassName}>Close</DrawerClose>}
              />
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    </div>
  )
}

export const SwipeToOpen: Story = {
  render: () => <SwipeToOpenDemo />,
}

const actionItems = [
  ['Duplicate app', 'Create a copy in the same workspace.'],
  ['Export DSL', 'Download the workflow definition.'],
  ['Move to folder', 'Organize this app with related work.'],
] as const

export const ActionSheet: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Open action sheet
      </DrawerTrigger>
      <DrawerParts popupClassName="data-[swipe-direction=down]:max-h-[80dvh]">
        <DrawerContent className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0))]">
          <div className={handleClassName} />
          <DrawerTitle className="mt-5 text-center text-lg/6 font-semibold text-text-primary">
            App actions
          </DrawerTitle>
          <DrawerDescription className="mt-1 text-center text-sm text-text-tertiary">
            Choose an action for Customer support assistant.
          </DrawerDescription>
          <div className="mt-5 overflow-hidden rounded-2xl border-[0.5px] border-divider-subtle bg-components-panel-bg">
            {actionItems.map(([label, description]) => (
              <DrawerClose key={label} className="flex w-full flex-col items-start gap-0.5 border-b-[0.5px] border-divider-subtle px-4 py-3 text-left last:border-b-0 hover:bg-state-base-hover">
                <span className="text-sm font-medium text-text-secondary">{label}</span>
                <span className="text-xs text-text-tertiary">{description}</span>
              </DrawerClose>
            ))}
          </div>
          <DrawerClose className={cn(destructiveCloseClassName, 'mt-3 w-full justify-center')}>
            Delete app
          </DrawerClose>
          <DrawerClose className={cn(textCloseClassName, 'mt-3 w-full justify-center')}>
            Cancel
          </DrawerClose>
        </DrawerContent>
      </DrawerParts>
    </Drawer>
  ),
}

type DetachedPayload = {
  title: string
  description: string
  fields: readonly string[]
}

const detachedPayloads = [
  {
    title: 'Profile',
    description: 'Update identity fields for the current member.',
    fields: ['Display name', 'Role', 'Location'],
  },
  {
    title: 'Billing',
    description: 'Review workspace billing contacts and usage limits.',
    fields: ['Plan', 'Billing email', 'Monthly usage'],
  },
] as const satisfies readonly DetachedPayload[]

function DetachedTriggersDemo() {
  const [drawerHandle] = React.useState(() => createDrawerHandle<DetachedPayload>())

  return (
    <div className="grid gap-4">
      <div className="flex justify-center gap-2">
        {detachedPayloads.map(payload => (
          <DrawerTrigger
            key={payload.title}
            handle={drawerHandle}
            payload={payload}
            render={<button type="button" className={triggerButtonClassName} />}
          >
            {payload.title}
          </DrawerTrigger>
        ))}
      </div>
      <Drawer handle={drawerHandle} swipeDirection="right">
        {({ payload }) => (
          <DrawerParts popupClassName="data-[swipe-direction=right]:max-w-[420px]">
            <DrawerFrame
              title={payload?.title ?? 'Detached drawer'}
              description={payload?.description ?? 'This drawer is opened by a trigger outside Drawer.Root.'}
              footer={<DrawerClose className={primaryCloseClassName}>Done</DrawerClose>}
            >
              <div className="grid gap-2">
                {(payload?.fields ?? ['Detached trigger']).map(field => (
                  <div key={field} className="rounded-xl border-[0.5px] border-divider-subtle px-3 py-2 text-sm text-text-secondary">
                    {field}
                  </div>
                ))}
              </div>
            </DrawerFrame>
          </DrawerParts>
        )}
      </Drawer>
    </div>
  )
}

export const DetachedTriggers: Story = {
  render: () => <DetachedTriggersDemo />,
}

export const StackingAndAnimations: Story = {
  render: () => (
    <Drawer swipeDirection="right">
      <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Open animated drawer
      </DrawerTrigger>
      <DrawerParts popupClassName="data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:shadow-none">
        <DrawerFrame
          title="Animation states"
          description="Dify's DrawerPopup responds to Base UI starting, ending, swiping, and nested data attributes."
          footer={<DrawerClose className={primaryCloseClassName}>Close</DrawerClose>}
        >
          <div className="grid gap-2">
            {['data-starting-style', 'data-ending-style', 'data-swiping', 'data-nested-drawer-open'].map(attribute => (
              <div key={attribute} className="rounded-xl bg-background-section-burn px-3 py-2 font-mono text-xs text-text-secondary">
                {attribute}
              </div>
            ))}
          </div>
        </DrawerFrame>
      </DrawerParts>
    </Drawer>
  ),
}
