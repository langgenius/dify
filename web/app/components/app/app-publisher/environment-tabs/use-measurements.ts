'use client'

import type { EnvironmentTabMeasurements, PublisherEnvironment } from './types'
import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_TABS_WIDTH,
  ENVIRONMENT_TAB_HORIZONTAL_PADDING,
  ENVIRONMENT_TAB_MAX_WIDTH,
  estimateFallbackTabWidth,
  estimateFallbackTextWidth,
} from './layout'

export function useEnvironmentTabMeasurements({
  builtInLabel,
  environments,
  moreEnvironmentsLabel,
  moreLabel,
}: {
  builtInLabel: string
  environments: readonly PublisherEnvironment[]
  moreEnvironmentsLabel: string
  moreLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measurementRef = useRef<HTMLDivElement>(null)
  const [measurements, setMeasurements] = useState<EnvironmentTabMeasurements>(() => ({
    availableWidth: DEFAULT_TABS_WIDTH,
    builtInWidth: estimateFallbackTabWidth(builtInLabel),
    environmentTextWidths: Object.fromEntries(
      environments.map((environment) => [
        environment.id,
        estimateFallbackTextWidth(environment.name),
      ]),
    ),
    moreEnvironmentsWidth:
      estimateFallbackTextWidth(moreEnvironmentsLabel) + ENVIRONMENT_TAB_HORIZONTAL_PADDING + 16,
    moreWidth: estimateFallbackTextWidth(moreLabel) + ENVIRONMENT_TAB_HORIZONTAL_PADDING + 16,
  }))

  useEffect(() => {
    const container = containerRef.current
    const measurementRoot = measurementRef.current
    if (!container || !measurementRoot) return

    const readElementWidth = (element: HTMLElement | null, fallback: number) => {
      return element?.getBoundingClientRect().width || element?.scrollWidth || fallback
    }
    const readWidth = (selector: string, fallback: number) =>
      readElementWidth(measurementRoot.querySelector<HTMLElement>(selector), fallback)
    const updateMeasurements = () => {
      const environmentMeasureElements = new Map(
        Array.from(measurementRoot.querySelectorAll<HTMLElement>('[data-environment-measure]')).map(
          (element) => [element.dataset.environmentMeasure, element],
        ),
      )
      const environmentTextWidths = Object.fromEntries(
        environments.map((environment) => [
          environment.id,
          readElementWidth(
            environmentMeasureElements.get(environment.id) ?? null,
            estimateFallbackTextWidth(environment.name),
          ),
        ]),
      )
      const nextMeasurements = {
        availableWidth:
          container.getBoundingClientRect().width || container.clientWidth || DEFAULT_TABS_WIDTH,
        builtInWidth: Math.min(
          ENVIRONMENT_TAB_MAX_WIDTH,
          readWidth(
            '[data-built-in-measure]',
            estimateFallbackTextWidth(builtInLabel) + ENVIRONMENT_TAB_HORIZONTAL_PADDING,
          ),
        ),
        environmentTextWidths,
        moreEnvironmentsWidth: readWidth(
          '[data-more-environments-measure]',
          estimateFallbackTextWidth(moreEnvironmentsLabel) +
            ENVIRONMENT_TAB_HORIZONTAL_PADDING +
            16,
        ),
        moreWidth: readWidth(
          '[data-more-measure]',
          estimateFallbackTextWidth(moreLabel) + ENVIRONMENT_TAB_HORIZONTAL_PADDING + 16,
        ),
      }

      setMeasurements((current) => {
        const environmentWidthsUnchanged = environments.every(
          (environment) =>
            current.environmentTextWidths[environment.id] ===
            nextMeasurements.environmentTextWidths[environment.id],
        )
        if (
          current.availableWidth === nextMeasurements.availableWidth &&
          current.builtInWidth === nextMeasurements.builtInWidth &&
          current.moreEnvironmentsWidth === nextMeasurements.moreEnvironmentsWidth &&
          current.moreWidth === nextMeasurements.moreWidth &&
          environmentWidthsUnchanged
        ) {
          return current
        }
        return nextMeasurements
      })
    }

    const animationFrame = requestAnimationFrame(updateMeasurements)
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(animationFrame)

    const observer = new ResizeObserver(updateMeasurements)
    observer.observe(container)
    observer.observe(measurementRoot)
    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
    }
  }, [builtInLabel, environments, moreEnvironmentsLabel, moreLabel])

  return { containerRef, measurementRef, measurements }
}
