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
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '../scroll-area'

const triggerButtonClassName = 'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
const textCloseClassName = 'inline-flex h-8 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3.5 text-[13px] font-medium text-components-button-secondary-text shadow-xs outline-hidden hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
const primaryCloseClassName = 'inline-flex h-8 items-center justify-center rounded-lg border-components-button-primary-border bg-components-button-primary-bg px-3.5 text-[13px] font-medium text-components-button-primary-text shadow outline-hidden hover:border-components-button-primary-border-hover hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
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
      <DrawerPortal>
        <DrawerBackdrop className="fixed" />
        <DrawerViewport>
          <DrawerPopup>
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                <div className="min-w-0">
                  <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                    Workspace settings
                  </DrawerTitle>
                  <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                    Review the key runtime defaults for this workspace.
                  </DrawerDescription>
                </div>
                <DrawerCloseButton className="shrink-0" />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                <div className="grid gap-3">
                  {settingRows.map(([label, value]) => (
                    <div key={label} className="rounded-xl border-[0.5px] border-divider-subtle bg-background-section-burn p-3">
                      <div className="text-xs font-medium text-text-tertiary">{label}</div>
                      <div className="mt-1 text-sm font-medium text-text-secondary">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                <DrawerClose className={textCloseClassName}>Cancel</DrawerClose>
                <DrawerClose className={primaryCloseClassName}>Save changes</DrawerClose>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
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
        <DrawerPortal>
          <DrawerBackdrop className="fixed" />
          <DrawerViewport>
            <DrawerPopup className="data-[swipe-direction=right]:max-w-105">
              <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                  <div className="min-w-0">
                    <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                      Controlled drawer
                    </DrawerTitle>
                    <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                      Use open and onOpenChange when the owning feature needs to react to close events.
                    </DrawerDescription>
                  </div>
                  <DrawerCloseButton className="shrink-0" />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                  <label className="grid gap-1 text-sm font-medium text-text-secondary" htmlFor="controlled-workspace-name">
                    Workspace name
                    <Input id="controlled-workspace-name" defaultValue="Acme workspace" autoComplete="organization" />
                  </label>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                  <DrawerClose className={textCloseClassName}>Dismiss</DrawerClose>
                  <DrawerClose className={primaryCloseClassName}>Done</DrawerClose>
                </div>
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
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
      <DrawerPortal>
        <DrawerBackdrop className="fixed" />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=down]:max-h-[80dvh] data-[swipe-direction=up]:max-h-[80dvh]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              {(direction === 'down' || direction === 'up') && <div className={handleClassName} />}
              <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                <div className="min-w-0">
                  <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                    {label}
                  </DrawerTitle>
                  <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                    {`This drawer is positioned with swipeDirection="${direction}" and the Dify default popup styles.`}
                  </DrawerDescription>
                </div>
                <DrawerCloseButton className="shrink-0" />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                <div className="rounded-xl border-[0.5px] border-divider-subtle bg-components-panel-bg-alt p-4 text-sm/5 text-text-secondary">
                  Position is controlled by Base UI data attributes and the drawer popup classes, not by a separate wrapper component.
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                <DrawerClose className={primaryCloseClassName}>Close</DrawerClose>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
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
              'pb-[max(0px,calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]',
              'after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-(--bleed) after:bg-inherit after:content-[""]',
              'data-[swipe-direction=down]:max-h-[calc(100dvh-var(--top-margin))]',
              'data-starting-style:pb-0 data-ending-style:pb-0',
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
      <DrawerPortal>
        <DrawerBackdrop className="fixed" />
        <DrawerViewport>
          <DrawerPopup className={nestedPopupClassName}>
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className={handleClassName} />
              <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                <div className="min-w-0">
                  <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                    Account
                  </DrawerTitle>
                  <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                    Open nested drawers from inside a drawer while the parent remains in the stack.
                  </DrawerDescription>
                </div>
                <DrawerCloseButton className="shrink-0" />
              </div>
              <div className="min-h-0 flex-1 px-6 pb-6" />
              <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                <Drawer>
                  <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
                    Security settings
                  </DrawerTrigger>
                  <DrawerPortal>
                    <DrawerViewport className="flex items-end justify-center">
                      <DrawerPopup className={nestedPopupClassName}>
                        <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                          <div className={handleClassName} />
                          <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                            <div className="min-w-0">
                              <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                                Security
                              </DrawerTitle>
                              <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                                Nested drawers keep their own title, close button, and focus scope.
                              </DrawerDescription>
                            </div>
                            <DrawerCloseButton className="shrink-0" />
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                            <ul className="grid gap-2 text-sm text-text-secondary">
                              <li className="rounded-xl bg-background-section-burn p-3">Passkeys enabled</li>
                              <li className="rounded-xl bg-background-section-burn p-3">2FA via authenticator app</li>
                              <li className="rounded-xl bg-background-section-burn p-3">3 signed-in devices</li>
                            </ul>
                          </div>
                          <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                            <Drawer>
                              <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
                                Advanced options
                              </DrawerTrigger>
                              <DrawerPortal>
                                <DrawerViewport className="flex items-end justify-center">
                                  <DrawerPopup className={nestedPopupClassName}>
                                    <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                                      <div className={handleClassName} />
                                      <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                                        <div className="min-w-0">
                                          <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                                            Advanced
                                          </DrawerTitle>
                                          <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                                            The stack uses Base UI nested drawer data attributes for visual treatment.
                                          </DrawerDescription>
                                        </div>
                                        <DrawerCloseButton className="shrink-0" />
                                      </div>
                                      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                                        <label className="grid gap-1 text-sm font-medium text-text-secondary" htmlFor="device-name">
                                          Device name
                                          <Input id="device-name" defaultValue="Personal laptop" />
                                        </label>
                                      </div>
                                      <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                                        <DrawerClose className={primaryCloseClassName}>Done</DrawerClose>
                                      </div>
                                    </DrawerContent>
                                  </DrawerPopup>
                                </DrawerViewport>
                              </DrawerPortal>
                            </Drawer>
                            <DrawerClose className={textCloseClassName}>Close security</DrawerClose>
                          </div>
                        </DrawerContent>
                      </DrawerPopup>
                    </DrawerViewport>
                  </DrawerPortal>
                </Drawer>
                <DrawerClose className={textCloseClassName}>Close</DrawerClose>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
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
                  <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                    <div className={handleClassName} />
                    <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                      <div className="min-w-0">
                        <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                          Notifications
                        </DrawerTitle>
                        <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                          The indented shell uses DrawerProvider, DrawerIndentBackground, and DrawerIndent.
                        </DrawerDescription>
                      </div>
                      <DrawerCloseButton className="shrink-0" />
                    </div>
                    <div className="min-h-0 flex-1" />
                    <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                      <DrawerClose className={primaryCloseClassName}>Close</DrawerClose>
                    </div>
                  </DrawerContent>
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
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                <div className="min-w-0">
                  <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                    Non-modal drawer
                  </DrawerTitle>
                  <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                    Focus is not trapped and outside pointer dismissal is disabled.
                  </DrawerDescription>
                </div>
                <DrawerCloseButton className="shrink-0" />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                <div className="rounded-xl border-[0.5px] border-divider-subtle bg-background-section-burn p-3 text-sm/5 text-text-secondary">
                  The background action remains clickable while this drawer is open. Outside clicks do not dismiss it.
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                <DrawerClose className={primaryCloseClassName}>Close</DrawerClose>
              </div>
            </DrawerContent>
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
      <DrawerPortal>
        <DrawerBackdrop className="fixed" />
        <DrawerViewport>
          <ScrollAreaRoot className="size-full overscroll-contain">
            <ScrollAreaViewport className="size-full touch-auto overscroll-contain" role="region" aria-label="Mobile drawer viewport">
              <ScrollAreaContent className="flex min-h-full min-w-0 items-end justify-center">
                <DrawerPopup className="data-[swipe-direction=down]:max-h-[92dvh]">
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
                      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
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
                      </div>
                    </DrawerContent>
                  </nav>
                </DrawerPopup>
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar orientation="vertical">
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollAreaRoot>
        </DrawerViewport>
      </DrawerPortal>
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
            <DrawerPopup className="absolute data-[swipe-direction=right]:max-w-90">
              <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                  <div className="min-w-0">
                    <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                      Library
                    </DrawerTitle>
                    <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                      Swipe from the edge whenever you want to jump back into a panel.
                    </DrawerDescription>
                  </div>
                  <DrawerCloseButton className="shrink-0" />
                </div>
                <div className="min-h-0 flex-1" />
                <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                  <DrawerClose className={primaryCloseClassName}>Close</DrawerClose>
                </div>
              </DrawerContent>
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

function ActionSheetDemo() {
  const [open, setOpen] = React.useState(false)

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Open action sheet
      </DrawerTrigger>
      <DrawerPortal>
        <DrawerBackdrop className="fixed" />
        <DrawerViewport>
          <DrawerPopup className="pointer-events-none flex gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0))] data-[swipe-direction=down]:max-h-[80dvh] data-[swipe-direction=down]:max-w-80">
            <DrawerContent className="pointer-events-auto overflow-hidden rounded-2xl border-[0.5px] border-divider-subtle bg-components-panel-bg p-0 pb-0 shadow-xl">
              <DrawerTitle className="sr-only">App actions</DrawerTitle>
              <DrawerDescription className="sr-only">
                Choose an action for Customer support assistant.
              </DrawerDescription>
              <ul className="m-0 list-none divide-y divide-divider-subtle p-0" aria-label="App actions">
                {actionItems.map(([label, description], index) => (
                  <li key={label}>
                    {index === 0 && <DrawerClose className="sr-only">Close action sheet</DrawerClose>}
                    <button
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 bg-transparent px-4 py-3 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                      onClick={() => setOpen(false)}
                    >
                      <span className="text-sm font-medium text-text-secondary">{label}</span>
                      <span className="text-xs text-text-tertiary">{description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </DrawerContent>
            <div className="pointer-events-auto overflow-hidden rounded-2xl border-[0.5px] border-divider-subtle bg-components-panel-bg shadow-xl">
              <button
                type="button"
                className="h-11 w-full bg-transparent px-4 text-center text-sm font-medium text-components-button-destructive-secondary-text outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => setOpen(false)}
              >
                Delete app
              </button>
            </div>
            <div className="pointer-events-auto overflow-hidden rounded-2xl border-[0.5px] border-divider-subtle bg-components-panel-bg shadow-xl">
              <button
                type="button"
                className="h-11 w-full bg-transparent px-4 text-center text-sm font-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            </div>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}

export const ActionSheet: Story = {
  render: () => <ActionSheetDemo />,
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
          <DrawerPortal>
            <DrawerBackdrop className="fixed" />
            <DrawerViewport>
              <DrawerPopup className="data-[swipe-direction=right]:max-w-105">
                <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                  <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                    <div className="min-w-0">
                      <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                        {payload?.title ?? 'Detached drawer'}
                      </DrawerTitle>
                      <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                        {payload?.description ?? 'This drawer is opened by a trigger outside Drawer.Root.'}
                      </DrawerDescription>
                    </div>
                    <DrawerCloseButton className="shrink-0" />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                    <div className="grid gap-2">
                      {(payload?.fields ?? ['Detached trigger']).map(field => (
                        <div key={field} className="rounded-xl border-[0.5px] border-divider-subtle px-3 py-2 text-sm text-text-secondary">
                          {field}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                    <DrawerClose className={primaryCloseClassName}>Done</DrawerClose>
                  </div>
                </DrawerContent>
              </DrawerPopup>
            </DrawerViewport>
          </DrawerPortal>
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
      <DrawerPortal>
        <DrawerBackdrop className="fixed" />
        <DrawerViewport>
          <DrawerPopup className="data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:shadow-none">
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
                <div className="min-w-0">
                  <DrawerTitle className="text-lg/6 font-semibold text-text-primary">
                    Animation states
                  </DrawerTitle>
                  <DrawerDescription className="mt-1 text-sm/5 text-text-tertiary">
                    Dify's DrawerPopup responds to Base UI starting, ending, swiping, and nested data attributes.
                  </DrawerDescription>
                </div>
                <DrawerCloseButton className="shrink-0" />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                <div className="grid gap-2">
                  {['data-starting-style', 'data-ending-style', 'data-swiping', 'data-nested-drawer-open'].map(attribute => (
                    <div key={attribute} className="rounded-xl bg-background-section-burn px-3 py-2 font-mono text-xs text-text-secondary">
                      {attribute}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
                <DrawerClose className={primaryCloseClassName}>Close</DrawerClose>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  ),
}
