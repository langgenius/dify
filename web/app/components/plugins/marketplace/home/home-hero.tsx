'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from '#i18n'
import dropboxDarkIcon from './assets/dropbox-dark.svg'
import dropboxLightIcon from './assets/dropbox-light.svg'
import duckDuckGoDarkIcon from './assets/duckduckgo-dark.svg'
import duckDuckGoLightIcon from './assets/duckduckgo-light.svg'
import githubDarkIcon from './assets/github-dark.svg'
import githubLightIcon from './assets/github-light.svg'
import googleDarkIcon from './assets/google-dark.svg'
import googleLightIcon from './assets/google-light.svg'
import styles from './home-hero.module.css'

type HomeHeroProps = {
  isMarketplacePlatform: boolean
  subtitle?: ReactNode
  title?: ReactNode
}

type HeroIconMark = {
  darkSrc: string
  lightSrc: string
}

const HERO_ICON_HOLD_MS = 4000
const HERO_ICON_GAP_MS = 100
const HERO_ICON_EXIT_MS = 400

const heroDecorationIconFrameClassName =
  'absolute flex size-10 items-center justify-center overflow-hidden rounded-[10px] bg-components-panel-bg shadow-lg'

// Rest `left`/`top` is the designed outward pose. Hidden offsets pull each
// mark toward the title so enter/exit travel radially, not in place.
const heroIconSlots = [
  { left: 99, top: 26, delay: 0, hiddenX: 32, hiddenY: 20 },
  { left: 12, top: 89, delay: 0.075, hiddenX: 36, hiddenY: -16 },
  { left: 589, top: 4, delay: 0, hiddenX: -32, hiddenY: 20 },
  { left: 653, top: 68, delay: 0.05, hiddenX: -36, hiddenY: -14 },
] as const

const heroIconSpring = {
  type: 'spring' as const,
  bounce: 0.4,
  duration: 0.25,
}

const heroIconVariantsForSlot = (slot: (typeof heroIconSlots)[number]) => ({
  hidden: {
    opacity: 0,
    scale: 0.5,
    x: slot.hiddenX,
    y: slot.hiddenY,
  },
  visible: {
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
  },
})

// First set is the designed placement. The second set swaps left/right pairs so
// the group replacement is visible with only these four marks.
const heroIconSets: HeroIconMark[][] = [
  [
    { darkSrc: dropboxDarkIcon.src, lightSrc: dropboxLightIcon.src },
    { darkSrc: duckDuckGoDarkIcon.src, lightSrc: duckDuckGoLightIcon.src },
    { darkSrc: githubDarkIcon.src, lightSrc: githubLightIcon.src },
    { darkSrc: googleDarkIcon.src, lightSrc: googleLightIcon.src },
  ],
  [
    { darkSrc: githubDarkIcon.src, lightSrc: githubLightIcon.src },
    { darkSrc: googleDarkIcon.src, lightSrc: googleLightIcon.src },
    { darkSrc: dropboxDarkIcon.src, lightSrc: dropboxLightIcon.src },
    { darkSrc: duckDuckGoDarkIcon.src, lightSrc: duckDuckGoLightIcon.src },
  ],
]

// Brand marks stay file exports so multi-color logos render. Tailwind iconify
// classes mask to currentColor and would flatten or hide them.
const ThemeIcon = ({
  darkSrc,
  lightSrc,
}: {
  darkSrc: string
  lightSrc: string
}) => (
  <>
    <img
      alt=""
      aria-hidden
      className={cn('size-10 object-cover', styles.iconLight)}
      src={lightSrc}
    />
    <img
      alt=""
      aria-hidden
      className={cn('size-10 object-cover', styles.iconDark)}
      src={darkSrc}
    />
  </>
)

const HeroDecorationIcons = () => {
  const reducedMotion = useReducedMotion()
  const [setIndex, setSetIndex] = useState(0)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (reducedMotion)
      return

    if (open) {
      const timeoutId = window.setTimeout(() => {
        setOpen(false)
      }, HERO_ICON_HOLD_MS)
      return () => window.clearTimeout(timeoutId)
    }

    const timeoutId = window.setTimeout(() => {
      setSetIndex(current => (current + 1) % heroIconSets.length)
      setOpen(true)
    }, HERO_ICON_EXIT_MS + HERO_ICON_GAP_MS)

    return () => window.clearTimeout(timeoutId)
  }, [open, reducedMotion])

  const icons = heroIconSets[setIndex] ?? heroIconSets[0]

  if (reducedMotion) {
    return (
      <div aria-hidden className={cn('pointer-events-none absolute inset-0', styles.decorations)}>
        {heroIconSets[0].map((icon, index) => {
          const slot = heroIconSlots[index]
          return (
            <span
              key={index}
              className={heroDecorationIconFrameClassName}
              style={{ left: slot.left, top: slot.top }}
            >
              <ThemeIcon darkSrc={icon.darkSrc} lightSrc={icon.lightSrc} />
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0', styles.decorations)}>
      {icons.map((icon, index) => {
        const slot = heroIconSlots[index]
        return (
          <motion.span
            key={index}
            className={heroDecorationIconFrameClassName}
            style={{ left: slot.left, top: slot.top }}
            variants={heroIconVariantsForSlot(slot)}
            initial="hidden"
            animate={open ? 'visible' : 'hidden'}
            transition={{ ...heroIconSpring, delay: slot.delay }}
          >
            <ThemeIcon darkSrc={icon.darkSrc} lightSrc={icon.lightSrc} />
          </motion.span>
        )
      })}
    </div>
  )
}

const HomeHero = ({ isMarketplacePlatform, subtitle, title }: HomeHeroProps) => {
  const { t } = useTranslation('plugin')

  return (
    <section
      className={cn(
        'relative flex shrink-0 justify-center bg-background-default px-4',
        !isMarketplacePlatform && 'pt-6',
      )}
    >
      <div className="relative flex h-[162px] w-full max-w-[726px] flex-col items-center pt-[41px]">
        <HeroDecorationIcons />
        <div className={cn('flex w-full flex-col items-center gap-2 text-center', styles.copyBlock)}>
          <h1
            className="text-[28px] leading-[1.2] font-medium tracking-[-0.56px] text-text-primary"
            style={{ fontFamily: "var(--font-family-brand, 'Söhne', var(--font-sans))" }}
          >
            {title ?? t(($) => $['marketplace.home.heroTitle'])}
          </h1>
          <p className="w-full text-[13px] leading-4 font-light tracking-[-0.065px] text-text-tertiary">
            {subtitle ?? t(($) => $['marketplace.home.heroSubtitle'])}
          </p>
        </div>
      </div>
    </section>
  )
}

export default HomeHero
