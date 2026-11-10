'use client'

import * as React from 'react'

export function RadioGroupIndicator() {
  const ref = React.useRef<HTMLSpanElement>(null)

  React.useLayoutEffect(() => {
    const thumb = ref.current!
    const group = thumb.parentElement!
    const getSelected = () => group.querySelector<HTMLElement>('[role="radio"][data-checked]')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let selected = getSelected()
    let slide: Animation | undefined
    let hideFill: Animation | undefined

    function stop() {
      if (slide) {
        slide.onfinish = null
        slide.cancel()
      }
      hideFill?.cancel()
      slide = undefined
      thumb.hidden = true
    }

    function update() {
      const next = getSelected()
      if (next === selected) return
      const from = (slide ? thumb : selected)?.getBoundingClientRect()
      selected = next
      stop()
      if (!next || !from?.width || reducedMotion.matches || next.matches(':focus-visible')) return

      const to = next.getBoundingClientRect()
      if (!to.width || !to.height) return

      // Paint the item's actual surface during the slide. Its layout and focus ring stay in place.
      const surface = getComputedStyle(next)
      Object.assign(thumb.style, {
        width: surface.width,
        height: surface.height,
        backgroundColor: surface.backgroundColor,
        border: surface.border,
        borderRadius: surface.borderRadius,
        boxShadow: surface.getPropertyValue('--tw-shadow'),
      })
      thumb.hidden = false
      const origin = thumb.getBoundingClientRect()
      const scaleX = origin.width / Number.parseFloat(surface.width)
      const scaleY = origin.height / Number.parseFloat(surface.height)
      const transform = (rect: DOMRect) =>
        `translate(${(rect.x - origin.x) / scaleX}px, ${(rect.y - origin.y) / scaleY}px) scale(${rect.width / origin.width}, ${rect.height / origin.height})`

      const timing: KeyframeAnimationOptions = {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'both',
      }
      const clear = {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        '--tw-shadow': '0 0 #0000',
      }
      hideFill = next.animate([clear, clear], timing)
      slide = thumb.animate([{ transform: transform(from) }, { transform: transform(to) }], timing)
      slide.onfinish = stop
    }

    const observer = new MutationObserver(update)
    observer.observe(group, {
      attributes: true,
      attributeFilter: ['data-checked'],
      childList: true,
      subtree: true,
    })
    reducedMotion.addEventListener('change', stop)
    return () => {
      observer.disconnect()
      reducedMotion.removeEventListener('change', stop)
      stop()
    }
  }, [])

  return (
    <span
      ref={ref}
      hidden
      aria-hidden="true"
      className="pointer-events-none absolute inset-s-0 top-0 origin-top-left"
    />
  )
}
