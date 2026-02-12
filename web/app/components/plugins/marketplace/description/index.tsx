'use client'

import type { MotionValue } from 'motion/react'
import { useTranslation } from '#i18n'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import marketPlaceBg from '@/public/marketplace/hero-bg.jpg'
import marketplaceGradientNoise from '@/public/marketplace/hero-gradient-noise.svg'
import { cn } from '@/utils/classnames'
import { useCreationType } from '../atoms'
import { PluginCategorySwitch, TemplateCategorySwitch } from '../category-switch/index'
import { CREATION_TYPE } from '../search-params'

type DescriptionProps = {
  className?: string
  scrollContainerId?: string
  marketplaceNav?: React.ReactNode
}

// Constants for collapse animation
const MAX_SCROLL = 120 // pixels to fully collapse
const EXPANDED_PADDING_TOP = 32 // pt-8
const COLLAPSED_PADDING_TOP = 12 // pt-3
const EXPANDED_PADDING_BOTTOM = 24 // pb-6
const COLLAPSED_PADDING_BOTTOM = 12 // pb-3

export const Description = ({
  className,
  scrollContainerId = 'marketplace-container',
  marketplaceNav,
}: DescriptionProps) => {
  const { t } = useTranslation('plugin')
  const creationType = useCreationType()
  const isTemplatesView = creationType === CREATION_TYPE.templates
  const heroTitleKey = isTemplatesView ? 'marketplace.templatesHeroTitle' : 'marketplace.pluginsHeroTitle'
  const heroSubtitleKey = isTemplatesView ? 'marketplace.templatesHeroSubtitle' : 'marketplace.pluginsHeroSubtitle'
  const rafRef = useRef<number | null>(null)
  const lastProgressRef = useRef(0)
  const titleContentRef = useRef<HTMLDivElement | null>(null)
  const progress = useMotionValue(0)
  const titleHeight = useMotionValue(72)
  const smoothProgress = useSpring(progress, { stiffness: 260, damping: 34 })

  useLayoutEffect(() => {
    const node = titleContentRef.current
    if (!node)
      return

    const updateHeight = () => {
      titleHeight.set(node.scrollHeight)
    }

    updateHeight()

    if (typeof ResizeObserver === 'undefined')
      return

    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)
    return () => observer.disconnect()
  }, [titleHeight])

  useEffect(() => {
    const container = document.getElementById(scrollContainerId)
    if (!container)
      return

    const handleScroll = () => {
      // Cancel any pending animation frame
      if (rafRef.current)
        cancelAnimationFrame(rafRef.current)

      // Use requestAnimationFrame for smooth updates
      rafRef.current = requestAnimationFrame(() => {
        const scrollTop = Math.round(container.scrollTop)
        const heightDelta = container.scrollHeight - container.clientHeight
        const effectiveMaxScroll = Math.max(1, Math.min(MAX_SCROLL, heightDelta))
        const rawProgress = Math.min(Math.max(scrollTop / effectiveMaxScroll, 0), 1)
        const snappedProgress = rawProgress >= 0.95
          ? 1
          : rawProgress <= 0.05
            ? 0
            : Math.round(rawProgress * 100) / 100

        if (snappedProgress !== lastProgressRef.current) {
          lastProgressRef.current = snappedProgress
          progress.set(snappedProgress)
        }
      })
    }

    container.addEventListener('scroll', handleScroll, { passive: true })

    // Initial check
    handleScroll()

    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (rafRef.current)
        cancelAnimationFrame(rafRef.current)
    }
  }, [progress, scrollContainerId])

  // Calculate interpolated values
  const contentOpacity = useTransform(smoothProgress, [0, 1], [1, 0])
  const contentScale = useTransform(smoothProgress, [0, 1], [1, 0.9])
  const titleMaxHeight: MotionValue<number> = useTransform(
    [smoothProgress, titleHeight],
    (values: number[]) => values[1] * (1 - values[0]),
  )
  const tabsMarginTop = useTransform(smoothProgress, [0, 1], [48, marketplaceNav ? 16 : 0])
  const titleMarginTop = useTransform(smoothProgress, [0, 1], [marketplaceNav ? 80 : 0, 0])
  const paddingTop = useTransform(smoothProgress, [0, 1], [marketplaceNav ? COLLAPSED_PADDING_TOP : EXPANDED_PADDING_TOP, COLLAPSED_PADDING_TOP])
  const paddingBottom = useTransform(smoothProgress, [0, 1], [EXPANDED_PADDING_BOTTOM, COLLAPSED_PADDING_BOTTOM])

  return (
    <motion.div
      className={cn(
        'sticky top-[60px] z-20 mx-4 mt-4 shrink-0 overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border px-6',
        className,
      )}
      style={{
        paddingTop,
        paddingBottom,
      }}
    >
      {/* Blue base background */}
      <div className="absolute inset-0 bg-[rgba(0,51,255,0.9)]" />

      {/* Decorative image with blend mode - showing top 1/3 of the image */}
      <div
        className="absolute inset-0 bg-no-repeat opacity-80 mix-blend-lighten"
        style={{
          backgroundImage: `url(${marketPlaceBg.src})`,
          backgroundSize: '110% auto',
          backgroundPosition: 'center top',
        }}
      />

      {/* Gradient & Noise overlay */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${marketplaceGradientNoise.src})` }}
      />

      {marketplaceNav}

      {/* Content */}
      <div className="relative z-10">
        {/* Title and subtitle - fade out and scale down */}
        <motion.div
          style={{
            opacity: contentOpacity,
            scale: contentScale,
            transformOrigin: 'left top',
            maxHeight: titleMaxHeight,
            overflow: 'hidden',
            willChange: 'opacity, transform',
            marginTop: titleMarginTop,
          }}
        >
          <div ref={titleContentRef}>
            <h1 className="title-4xl-semi-bold mb-2 shrink-0 text-text-primary-on-surface">
              {t(heroTitleKey)}
            </h1>
            <h2 className="body-md-regular shrink-0 text-text-secondary-on-surface">
              {t(heroSubtitleKey)}
            </h2>
          </div>
        </motion.div>

        {/* Category switch tabs - Plugin or Template based on creationType */}
        <motion.div style={{ marginTop: tabsMarginTop }}>
          {isTemplatesView
            ? (
                <TemplateCategorySwitch variant="hero" />
              )
            : (
                <PluginCategorySwitch variant="hero" />
              )}
        </motion.div>
      </div>
    </motion.div>
  )
}
