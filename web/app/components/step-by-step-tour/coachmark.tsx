'use client'

import type { PopoverChangeEventDetails, PopoverPositionerProps } from '@langgenius/dify-ui/popover'
import type { KeyboardEvent } from 'react'
import type { StepByStepTourGuide, StepByStepTourGuideInteractionPolicy } from './target-registry'
import type { StepByStepTourTargetRect } from './use-target-rect'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverArrow,
  PopoverBackdrop,
  PopoverClose,
  PopoverDescription,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
} from '@langgenius/dify-ui/popover'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getStepByStepTourGuideKind, getStepByStepTourTargetSelector } from './target-registry'
import { useStepByStepTourTargetRect } from './use-target-rect'

const HIGHLIGHT_PADDING = 4
// The vertical arrow's dot sits this far from the target's left edge, as in the Figma frame.
const VERTICAL_ARROW_DOT_LEFT = 28
const STEP_GLIDE_DURATION = 400
const STEP_GLIDE_CLASS_NAME =
  'data-gliding:duration-300 data-gliding:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
const TARGET_TABBABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

type StepByStepTourCoachmarkPlacement = 'bottom' | 'inline-end' | 'top'

// Base UI centers the arrow on the anchor: narrow the anchor to the spot the arrow points at, and let
// `alignOffset` move the popup back to the highlight's edge.
const getStepByStepTourCoachmarkAnchoring = (
  placement: StepByStepTourCoachmarkPlacement,
  highlightRect: StepByStepTourTargetRect,
  anchorRect: StepByStepTourTargetRect,
): Pick<PopoverPositionerProps, 'alignOffset' | 'anchor'> => {
  if (placement === 'inline-end') {
    const rect = new DOMRect(
      highlightRect.left,
      anchorRect.top,
      highlightRect.width,
      anchorRect.height,
    )
    return { anchor: { getBoundingClientRect: () => rect }, alignOffset: 0 }
  }

  const arrowDotLeft = anchorRect.left + VERTICAL_ARROW_DOT_LEFT
  const rect = new DOMRect(arrowDotLeft, highlightRect.top, 2, highlightRect.height)
  return {
    anchor: { getBoundingClientRect: () => rect },
    alignOffset: highlightRect.left - arrowDotLeft,
  }
}

const getTargetOnlyClipPath = ({ height, left, top, width }: StepByStepTourTargetRect) => {
  const right = left + width
  const bottom = top + height
  return `polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,${left}px ${top}px,${left}px ${bottom}px,${right}px ${bottom}px,${right}px ${top}px,${left}px ${top}px)`
}

const isRectInViewport = ({ height, left, top, width }: StepByStepTourTargetRect) =>
  top < window.innerHeight && top + height > 0 && left < window.innerWidth && left + width > 0

const useStepGliding = (stepKey: string | undefined) => {
  const [glide, setGlide] = useState({ gliding: false, stepKey })
  if (glide.stepKey !== stepKey) setGlide({ gliding: Boolean(glide.stepKey && stepKey), stepKey })

  useEffect(() => {
    if (!glide.gliding) return

    const timeout = window.setTimeout(
      () => setGlide((current) => ({ ...current, gliding: false })),
      STEP_GLIDE_DURATION,
    )
    return () => window.clearTimeout(timeout)
  }, [glide])

  return glide.gliding
}

type StepByStepTourCoachmarkGuide = Omit<
  StepByStepTourGuide,
  'description' | 'learnMoreLabel' | 'primaryActionLabel' | 'title'
> & {
  description: string
  learnMoreHref?: string
  learnMoreLabel: string
  primaryActionLabel: string
  title: string
}

type StepByStepTourCoachmarkProps = {
  guide: StepByStepTourCoachmarkGuide
  targetElement: HTMLElement | null
  placement?: StepByStepTourCoachmarkPlacement
  stepLabel: string
  skipLabel: string
  interactionPolicy: StepByStepTourGuideInteractionPolicy
  onSkip: () => void
  onComplete: () => void
}

type StepByStepTourCoachmarkOverlay = Omit<
  StepByStepTourCoachmarkProps,
  'onComplete' | 'onSkip' | 'targetElement'
> & {
  anchorRect: StepByStepTourTargetRect
  highlightRect: StepByStepTourTargetRect
  placement: StepByStepTourCoachmarkPlacement
}

export function StepByStepTourCoachmark({
  guide,
  targetElement,
  placement = 'bottom',
  stepLabel,
  skipLabel,
  interactionPolicy,
  onSkip,
  onComplete,
}: StepByStepTourCoachmarkProps) {
  const targetRects = useStepByStepTourTargetRect(targetElement, guide.highlightPartSelectors)
  const portalRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const primaryActionRef = useRef<HTMLButtonElement>(null)
  const lastOverlayRef = useRef<StepByStepTourCoachmarkOverlay | undefined>(undefined)

  const currentOverlay: StepByStepTourCoachmarkOverlay | undefined =
    targetElement &&
    targetRects?.targetElement === targetElement &&
    targetRects.highlightPartsReady &&
    targetRects.rectSettled &&
    targetElement.matches(getStepByStepTourTargetSelector(guide.target))
      ? {
          anchorRect: targetRects.anchorRect,
          guide,
          highlightRect: targetRects.highlightRect,
          interactionPolicy,
          placement,
          skipLabel,
          stepLabel,
        }
      : undefined

  const [awaitingTarget, setAwaitingTarget] = useState(true)
  if (!targetElement && !awaitingTarget) setAwaitingTarget(true)
  if (currentOverlay && awaitingTarget && isRectInViewport(currentOverlay.highlightRect))
    setAwaitingTarget(false)

  useLayoutEffect(() => {
    if (currentOverlay) lastOverlayRef.current = currentOverlay
  })

  const overlay = currentOverlay ?? lastOverlayRef.current
  const open = Boolean(!awaitingTarget && overlay)
  const gliding = useStepGliding(open ? overlay?.guide.id : undefined)
  const isActionGuide = overlay ? getStepByStepTourGuideKind(overlay.guide) === 'action' : false
  const overlayPlacement = overlay?.placement
  const overlayHighlightRect = overlay?.highlightRect
  const overlayAnchorRect = overlay?.anchorRect
  const anchoring = useMemo(
    () =>
      overlayPlacement && overlayHighlightRect && overlayAnchorRect
        ? getStepByStepTourCoachmarkAnchoring(
            overlayPlacement,
            overlayHighlightRect,
            overlayAnchorRect,
          )
        : undefined,
    [overlayPlacement, overlayHighlightRect, overlayAnchorRect],
  )

  // Overlays stack in DOM order: remount after an overlay that holds the target and opened later.
  const [portalKey, setPortalKey] = useState(0)
  useLayoutEffect(() => {
    const portal = portalRef.current
    if (
      open &&
      portal &&
      targetElement &&
      portal.compareDocumentPosition(targetElement) & Node.DOCUMENT_POSITION_FOLLOWING
    )
      setPortalKey((key) => key + 1)
  }, [open, targetElement])

  const readyStepKey = currentOverlay?.guide.id
  useEffect(() => {
    const popup = popupRef.current
    if (!readyStepKey || !popup) return

    const activeElement = document.activeElement
    if (
      activeElement &&
      activeElement !== document.body &&
      !activeElement.closest('[aria-hidden="true"]')
    )
      return

    ;(primaryActionRef.current ?? popup).focus()
  }, [readyStepKey])

  const spotlightRect = overlay && {
    height: overlay.highlightRect.height + HIGHLIGHT_PADDING * 2,
    left: overlay.highlightRect.left - HIGHLIGHT_PADDING,
    top: overlay.highlightRect.top - HIGHLIGHT_PADDING,
    width: overlay.highlightRect.width + HIGHLIGHT_PADDING * 2,
  }

  const handleOpenChange = (nextOpen: boolean, eventDetails: PopoverChangeEventDetails) => {
    if (
      !nextOpen &&
      (eventDetails.reason === 'escape-key' || eventDetails.reason === 'close-press')
    )
      onSkip()
  }

  // Without a trigger, Tab out of the popup would land at the end of the document.
  const handleSkipKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Tab' || event.shiftKey || !targetElement) return

    const targetTabbable = targetElement.matches(TARGET_TABBABLE_SELECTOR)
      ? targetElement
      : targetElement.querySelector<HTMLElement>(TARGET_TABBABLE_SELECTOR)
    if (!targetTabbable) return

    event.preventDefault()
    targetTabbable.focus()
  }

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      modal={overlay?.interactionPolicy === 'blocked' ? 'trap-focus' : false}
    >
      {overlay && anchoring && (
        <PopoverPortal key={portalKey} ref={portalRef}>
          {open && (
            <div
              aria-hidden="true"
              data-step-by-step-tour-blocker=""
              className="fixed inset-0 cursor-default"
              style={{
                clipPath:
                  overlay.interactionPolicy === 'target-only' && spotlightRect
                    ? getTargetOnlyClipPath(spotlightRect)
                    : undefined,
              }}
            />
          )}
          <PopoverBackdrop
            data-step-by-step-tour-highlight=""
            data-gliding={gliding ? '' : undefined}
            className={cn(
              'pointer-events-none inset-auto rounded-xl shadow-[0_0_0_9999px_var(--color-background-overlay)] transition-opacity data-ending-style:opacity-0 data-gliding:transition-[top,left,width,height,opacity] data-starting-style:opacity-0',
              STEP_GLIDE_CLASS_NAME,
            )}
            style={spotlightRect}
          />
          <PopoverPositioner
            anchor={anchoring.anchor}
            side={overlay.placement}
            align={overlay.placement === 'inline-end' ? 'center' : 'start'}
            alignOffset={anchoring.alignOffset}
            sideOffset={20}
            arrowPadding={12}
            collisionPadding={8}
            collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
            positionMethod="fixed"
            data-gliding={gliding ? '' : undefined}
            data-step-by-step-tour-coachmark=""
            className={cn('data-gliding:transition-[top,left,transform]', STEP_GLIDE_CLASS_NAME)}
          >
            <PopoverPopup
              ref={popupRef}
              initialFocus={() => primaryActionRef.current ?? popupRef.current}
              finalFocus={false}
              className={cn(
                'relative flex w-88 max-w-[calc(100vw-16px)] flex-col rounded-2xl border-[0.5px] border-state-accent-hover-alt bg-state-accent-hover p-4 shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)] backdrop-blur-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid focus-visible:outline-solid',
                isActionGuide ? 'min-h-29.5' : 'min-h-39.5',
              )}
            >
              <PopoverArrow
                className={(state) =>
                  state.side === 'inline-end' || state.side === 'inline-start'
                    ? cn(
                        'pointer-events-none size-3 rotate-45 border-state-accent-hover-alt bg-state-accent-hover',
                        state.side === 'inline-end'
                          ? '-inset-s-1.5 border-s-[0.5px] border-b-[0.5px]'
                          : '-inset-e-1.5 border-e-[0.5px] border-t-[0.5px]',
                      )
                    : cn(
                        'pointer-events-none h-7 w-0.5',
                        state.side === 'top' ? '-bottom-4.75 rotate-180' : '-top-4.75',
                      )
                }
                render={(props, state) => (
                  <div {...props}>
                    {(state.side === 'top' || state.side === 'bottom') && (
                      <>
                        <span className="absolute top-0 left-1/2 h-7 w-0.5 -translate-x-1/2 bg-state-accent-hover-alt shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)]" />
                        <span className="absolute -top-0.75 left-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-state-accent-hover bg-state-accent-solid shadow-xs" />
                      </>
                    )}
                  </div>
                )}
              />
              <div
                key={overlay.guide.id}
                className="transition-opacity duration-200 motion-reduce:transition-none starting:opacity-0"
              >
                <div className="pb-0.5 system-2xs-semibold-uppercase text-text-tertiary">
                  {overlay.stepLabel}
                </div>
                {isActionGuide ? (
                  <PopoverTitle render={<p />} className="mt-1 system-md-medium text-text-primary">
                    {overlay.guide.description}
                  </PopoverTitle>
                ) : (
                  <>
                    <PopoverTitle className="mt-1 system-md-medium text-text-primary">
                      {overlay.guide.title}
                    </PopoverTitle>
                    <PopoverDescription className="mt-1 system-xs-regular text-text-secondary">
                      {overlay.guide.description}
                    </PopoverDescription>
                  </>
                )}
              </div>
              <div
                className={cn(
                  'mt-auto flex h-12 justify-between gap-3 pt-4',
                  isActionGuide ? 'items-end' : 'items-center',
                )}
              >
                <PopoverClose
                  className="shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0 text-start system-sm-regular text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onKeyDown={
                    overlay.interactionPolicy === 'target-only' ? handleSkipKeyDown : undefined
                  }
                >
                  {overlay.skipLabel}
                </PopoverClose>
                {!isActionGuide && (
                  <div className="flex shrink-0 items-center gap-1">
                    {overlay.guide.learnMoreHref && (
                      <a
                        href={overlay.guide.learnMoreHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          buttonVariants({ variant: 'ghost', size: 'medium' }),
                          'text-text-tertiary',
                        )}
                      >
                        {overlay.guide.learnMoreLabel}
                        <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
                      </a>
                    )}
                    <Button
                      ref={primaryActionRef}
                      variant="primary"
                      size="medium"
                      className="min-w-20 px-3"
                      onClick={currentOverlay ? onComplete : undefined}
                    >
                      {overlay.guide.primaryActionLabel}
                    </Button>
                  </div>
                )}
              </div>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      )}
    </Popover>
  )
}
