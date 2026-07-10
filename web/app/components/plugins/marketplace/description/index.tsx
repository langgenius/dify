'use client'

import type { MotionValue } from 'motion/react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocale, useTranslation } from '#i18n'
import Divider from '@/app/components/base/divider'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { SubmitRequestDropdown } from '@/app/components/plugins/plugin-page/nav-operations'
import PluginTypeSwitch from '../plugin-type-switch'
import SearchBoxWrapper from '../search-box/search-box-wrapper'

type DescriptionProps = {
  isMarketplacePlatform?: boolean
  marketplaceNav?: React.ReactNode
  scrollContainerId?: string
}

const MAX_SCROLL = 120
const EXPANDED_PADDING_TOP = 32
const COLLAPSED_PADDING_TOP = 12
const EXPANDED_PADDING_BOTTOM = 24
const COLLAPSED_PADDING_BOTTOM = 12
const EXPANDED_TITLE_MARGIN_TOP = 32
const EXPANDED_TABS_MARGIN_TOP = 32

const Description = ({
  isMarketplacePlatform = false,
  marketplaceNav,
  scrollContainerId = 'marketplace-container',
}: DescriptionProps) => {
  const { t } = useTranslation('plugin')
  const { t: tCommon } = useTranslation('common')
  const locale = useLocale()
  const isZhHans = locale === 'zh-Hans'
  const rafRef = useRef<number | null>(null)
  const lastProgressRef = useRef(0)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const titleContentRef = useRef<HTMLDivElement | null>(null)
  const hasMarketplaceNav = isMarketplacePlatform
  const progress = useMotionValue(0)
  const titleHeight = useMotionValue(72)
  const smoothProgress = useSpring(progress, { stiffness: 260, damping: 34 })

  useLayoutEffect(() => {
    if (!isMarketplacePlatform)
      return

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
  }, [isMarketplacePlatform, titleHeight])

  useEffect(() => {
    if (!isMarketplacePlatform)
      return

    const container = document.getElementById(scrollContainerId)
    if (!container)
      return

    const handleScroll = () => {
      if (rafRef.current)
        cancelAnimationFrame(rafRef.current)

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
    handleScroll()

    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (rafRef.current)
        cancelAnimationFrame(rafRef.current)
    }
  }, [isMarketplacePlatform, progress, scrollContainerId])

  useEffect(() => {
    if (!isMarketplacePlatform)
      return

    const container = document.getElementById(scrollContainerId)
    const header = headerRef.current
    if (!container || !header)
      return

    let maxHeaderHeight = 0
    let lastAppliedOffset = 0
    const updateOffset = () => {
      const currentHeaderHeight = Math.round(header.getBoundingClientRect().height)
      maxHeaderHeight = Math.max(maxHeaderHeight, currentHeaderHeight)
      const collapsedHeight = Math.max(0, maxHeaderHeight - currentHeaderHeight)
      const currentScrollableTop = container.scrollHeight - container.clientHeight
      const baseScrollableTop = Math.max(0, currentScrollableTop - lastAppliedOffset)
      const shouldCompensate = baseScrollableTop <= maxHeaderHeight
      const nextOffset = shouldCompensate ? collapsedHeight : 0
      const offsetDelta = nextOffset - lastAppliedOffset

      if (nextOffset > 0) {
        container.style.setProperty('--marketplace-header-collapse-offset', `${nextOffset}px`)
        if (offsetDelta !== 0 && container.scrollTop > 0)
          container.scrollTop = Math.max(0, container.scrollTop + offsetDelta)
      }
      else {
        container.style.removeProperty('--marketplace-header-collapse-offset')
      }

      lastAppliedOffset = nextOffset
    }

    updateOffset()

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        container.style.removeProperty('--marketplace-header-collapse-offset')
      }
    }

    const observer = new ResizeObserver(updateOffset)
    observer.observe(header)
    observer.observe(container)

    return () => {
      observer.disconnect()
      container.style.removeProperty('--marketplace-header-collapse-offset')
    }
  }, [isMarketplacePlatform, scrollContainerId])

  const contentOpacity = useTransform(smoothProgress, [0, 1], [1, 0])
  const contentScale = useTransform(smoothProgress, [0, 1], [1, 0.9])
  const titleMaxHeight: MotionValue<number> = useTransform(
    [smoothProgress, titleHeight],
    (values: number[]) => {
      const currentProgress = values[0] ?? 0
      const currentTitleHeight = values[1] ?? 72
      return currentTitleHeight * (1 - currentProgress)
    },
  )
  const tabsMarginTop = useTransform(smoothProgress, [0, 1], [EXPANDED_TABS_MARGIN_TOP, hasMarketplaceNav ? 16 : 0])
  const titleMarginTop = useTransform(smoothProgress, [0, 1], [hasMarketplaceNav ? EXPANDED_TITLE_MARGIN_TOP : 0, 0])
  const paddingTop = useTransform(smoothProgress, [0, 1], [hasMarketplaceNav ? COLLAPSED_PADDING_TOP : EXPANDED_PADDING_TOP, COLLAPSED_PADDING_TOP])
  const paddingBottom = useTransform(smoothProgress, [0, 1], [EXPANDED_PADDING_BOTTOM, COLLAPSED_PADDING_BOTTOM])

  if (!isMarketplacePlatform) {
    return (
      <>
        <h1 className="mb-2 shrink-0 text-center title-4xl-semi-bold text-text-primary">
          {t($ => $['marketplace.empower'])}
        </h1>
        <h2 className="flex shrink-0 items-center justify-center text-center body-md-regular text-text-tertiary">
          {
            isZhHans && (
              <>
                <span className="mr-1">{tCommon($ => $['operation.in'])}</span>
                {t($ => $['marketplace.difyMarketplace'])}
                {t($ => $['marketplace.discover'])}
              </>
            )
          }
          {
            !isZhHans && (
              <>
                {t($ => $['marketplace.discover'])}
              </>
            )
          }
          <span className="relative z-1 ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
            {t($ => $['category.models'])}
          </span>
          ,
          <span className="relative z-1 ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
            {t($ => $['category.tools'])}
          </span>
          ,
          <span className="relative z-1 ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
            {t($ => $['category.datasources'])}
          </span>
          ,
          <span className="relative z-1 ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
            {t($ => $['category.triggers'])}
          </span>
          ,
          <span className="relative z-1 ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
            {t($ => $['category.agents'])}
          </span>
          ,
          <span className="relative z-1 mr-1 ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
            {t($ => $['category.extensions'])}
          </span>
          {t($ => $['marketplace.and'])}
          <span className="relative z-1 mr-1 ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
            {t($ => $['category.bundles'])}
          </span>
          {
            !isZhHans && (
              <>
                <span className="mr-1">{tCommon($ => $['operation.in'])}</span>
                {t($ => $['marketplace.difyMarketplace'])}
              </>
            )
          }
        </h2>
      </>
    )
  }

  const defaultMarketplaceNav = (
    <div className="relative z-20 flex w-full flex-col items-start">
      <div className="flex h-[60px] w-full items-center rounded-lg border-[0.5px] border-white/50 bg-components-panel-bg-blur backdrop-blur-[6px]">
        <div className="flex h-full min-w-0 flex-1 items-center px-5 py-2">
          <div className="flex shrink-0 items-center gap-1.5">
            <DifyLogo alt="" className="h-6 w-[52px]" />
            <span className="max-w-0 overflow-hidden title-3xl-semi-bold whitespace-nowrap text-text-primary opacity-0 transition-all duration-200 md:max-w-[150px] md:opacity-100">
              {tCommon($ => $['mainNav.marketplace'])}
            </span>
          </div>
        </div>
        <SearchBoxWrapper
          wrapperClassName="z-11 w-64 shrink-0"
          inputClassName="h-9 w-full rounded-[10px]"
          inputElementClassName="text-[14px] leading-5 font-normal"
          searchIconClassName="size-4"
          placeholder={tCommon($ => $['placeholder.search'])}
          showTags={false}
          usedInMarketplace={false}
        />
        <div className="flex h-full shrink-0 items-center justify-end gap-4 pr-3.5 pl-4">
          <Divider type="vertical" className="mx-0 h-4 bg-divider-regular" />
          <SubmitRequestDropdown dividerAfterFirst />
        </div>
      </div>
    </div>
  )

  return (
    <motion.div
      ref={headerRef}
      className="sticky top-0 z-20 w-full shrink-0 overflow-hidden rounded-lg px-3"
      style={{
        paddingTop,
        paddingBottom,
      }}
    >
      <div className="absolute inset-0 bg-[#0033ff]" />
      <div
        className="absolute inset-0 bg-no-repeat opacity-80 mix-blend-lighten"
        style={{
          backgroundImage: 'url(/marketplace/hero-bg.jpg)',
          backgroundPosition: 'center top',
          backgroundSize: '110% auto',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/marketplace/hero-gradient-noise.svg)' }}
      />
      {marketplaceNav ?? defaultMarketplaceNav}
      <div className="relative z-10 mx-5">
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
            <h1 className="mb-2 shrink-0 text-[30px] leading-9 font-semibold text-text-primary-on-surface">
              {t($ => $['marketplace.pluginsHeroTitle'])}
            </h1>
            <h2 className="shrink-0 body-md-medium text-text-secondary-on-surface">
              {t($ => $['marketplace.pluginsHeroSubtitle'])}
            </h2>
          </div>
        </motion.div>
        <motion.div style={{ marginTop: tabsMarginTop }}>
          <PluginTypeSwitch variant="hero" />
        </motion.div>
      </div>
    </motion.div>
  )
}

export default Description
