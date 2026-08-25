'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import brain2FillIcon from './assets/brain-2-fill.svg'
import imageCircleAiLineIcon from './assets/image-circle-ai-line.svg'
import plugFillIcon from './assets/plug-fill.svg'
import puzzleFillIcon from './assets/puzzle-fill.svg'
import sparklingFillIcon from './assets/sparkling-fill.svg'
import voiceAiFillIcon from './assets/voice-ai-fill.svg'
import { HERO_ICON_SIZE_PX } from './home-constants'
import styles from './home-hero.module.css'

type HomeHeroProps = {
  isMarketplacePlatform: boolean
  subtitle?: ReactNode
  title?: ReactNode
}

type HeroDecorationIcon = {
  left: number
  src: string
  top: number
}

const heroIconSrc = (icon: { src: string } | string) => (typeof icon === 'string' ? icon : icon.src)

// Positions are Figma offsets from the 1512px canvas center, with the top
// icon row shifted to y=0 so the marks sit in HomeHero instead of the header.
const heroDecorationIcons: HeroDecorationIcon[] = [
  { src: heroIconSrc(sparklingFillIcon), left: -450, top: 41 },
  { src: heroIconSrc(plugFillIcon), left: -286, top: 0 },
  { src: heroIconSrc(puzzleFillIcon), left: -327, top: 123 },
  { src: heroIconSrc(brain2FillIcon), left: 247, top: 82 },
  { src: heroIconSrc(imageCircleAiLineIcon), left: 370, top: 123 },
  { src: heroIconSrc(voiceAiFillIcon), left: 411, top: 0 },
]

const HeroDecorations = () => (
  <div aria-hidden className={styles.decorations}>
    <div className={styles.grid} />
    <div className={styles.glow} />
    {heroDecorationIcons.map((icon) => (
      <span
        key={icon.src}
        className="absolute flex items-center justify-center overflow-hidden bg-state-accent-hover"
        style={{
          height: HERO_ICON_SIZE_PX,
          left: `calc(50% + ${icon.left}px)`,
          top: icon.top,
          width: HERO_ICON_SIZE_PX,
        }}
      >
        <span className="relative size-[24px] overflow-hidden">
          <img alt="" aria-hidden className="size-full" height={24} src={icon.src} width={24} />
        </span>
      </span>
    ))}
  </div>
)

const HomeHero = ({ isMarketplacePlatform, subtitle, title }: HomeHeroProps) => {
  const { t } = useTranslation('plugin')

  return (
    <section
      className={cn(
        'relative flex shrink-0 justify-center overflow-hidden bg-background-default px-4',
        !isMarketplacePlatform && 'pt-6',
      )}
    >
      <HeroDecorations />
      <div
        className={cn(
          'relative flex w-full max-w-[726px] flex-col items-center pt-[41px]',
          styles.frame,
        )}
      >
        <div
          className={cn('flex w-full flex-col items-center gap-2 text-center', styles.copyBlock)}
        >
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
