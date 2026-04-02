/* eslint-disable ts/ban-ts-comment */
// @ts-nocheck

import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupSVG, deOptimisePaths, isEmptyColor, parseColors, runSVGO, SVG } from '@iconify/tools'
import { compareColors, stringToColor } from '@iconify/utils/lib/colors'
import { FileSystemIconLoader } from '@iconify/utils/lib/loader/node-loaders'
import { defineConfig, presetIcons, presetTypography, presetWind3, transformerDirectives } from 'unocss'
import tailwindThemeVarDefine from './themes/tailwind-theme-var-define.ts'

const dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url))

const blackColor = stringToColor('black')
const whiteColor = stringToColor('white')

const transformSvgToCurrentColor = (source: string) => {
  const svg = new SVG(source)

  cleanupSVG(svg)
  parseColors(svg, {
    defaultColor: 'currentColor',
    callback: (attr, colorString, color) => {
      if (!color)
        throw new Error(`Invalid color: "${colorString}" in attribute ${attr}`)
      if (isEmptyColor(color))
        return color
      if (compareColors(color, blackColor))
        return 'currentColor'
      if (compareColors(color, whiteColor))
        return 'remove'
      return 'currentColor'
    },
  })
  runSVGO(svg)
  deOptimisePaths(svg)

  return svg.toString()
}

const findSvgDirectories = (rootDir: string) => {
  const result: string[] = []

  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true })
    const subdirs: string[] = []
    let hasSvgFiles = false

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.svg'))
        hasSvgFiles = true
      else if (entry.isDirectory())
        subdirs.push(path.join(dir, entry.name))
    }

    if (hasSvgFiles)
      result.push(dir)

    for (const subdir of subdirs)
      walk(subdir)
  }

  walk(rootDir)
  return result
}

const createCollectionLoaders = (source: string, prefix: string) => {
  const directories = findSvgDirectories(source)

  return Object.fromEntries(
    directories.map((dir) => {
      const pathPrefix = path.relative(source, dir).split(path.sep).join('-')
      return [
        `${prefix}-${pathPrefix}`,
        FileSystemIconLoader(dir, transformSvgToCurrentColor),
      ]
    }),
  )
}

const publicCollections = createCollectionLoaders(
  path.resolve(dirname, 'app/components/base/icons/assets/public'),
  'custom-public',
)

const venderCollections = createCollectionLoaders(
  path.resolve(dirname, 'app/components/base/icons/assets/vender'),
  'custom-vender',
)

export default defineConfig({
  blocklist: [
    /\$\{/,
    /^(?:Array|array)\[/,
    /^[A-Z][A-Z0-9_[\].-]*$/,
    /bg-\[var\(--sdm-bg,inherit\]/,
    /bg-\[var\(--shiki-dark-bg,var\(--sdm-bg,inherit\)\]/,
  ],
  rules: [
    ['bg-[var(--sdm-bg,inherit]', { 'background-color': 'var(--sdm-bg,inherit)' }],
    ['bg-[var(--shiki-dark-bg,var(--sdm-bg,inherit)]', { 'background-color': 'var(--shiki-dark-bg,var(--sdm-bg,inherit))' }],
  ],
  content: {
    pipeline: {
      include: [
        /\.(vue|svelte|[jt]sx|vine.ts|mdx?|astro|elm|php|phtml|marko|html)($|\?)/,
        /\/app\/.*\.[jt]s($|\?)/,
        /\/context\/.*\.[jt]s($|\?)/,
        /\/node_modules\/streamdown\/dist\/.*\.js($|\?)/,
        /\/node_modules\/@streamdown\/math\/dist\/.*\.js($|\?)/,
      ],
      exclude: [
        /\/__tests__\//,
        /\.(spec|test)\.[jt]sx?($|\?)/,
      ],
    },
  },
  presets: [
    presetWind3(),
    presetTypography(),
    presetIcons({
      collections: {
        ...publicCollections,
        ...venderCollections,
      },
      extraProperties: {
        width: '1rem',
        height: '1rem',
        display: 'block',
      },
    }),
  ],
  transformers: [
    transformerDirectives(),
  ],
  extendTheme: (theme) => {
    theme.breakpoints = {
      ...theme.breakpoints,
      'mobile': '100px',
      'tablet': '640px',
      'pc': '769px',
      '2k': '2560px',
    }
    theme.colors = {
      ...theme.colors,
      'gray': {
        ...theme.colors?.gray,
        25: '#fcfcfd',
        50: '#f9fafb',
        100: '#f2f4f7',
        200: '#eaecf0',
        300: '#d0d5dd',
        400: '#98a2b3',
        500: '#667085',
        600: '#344054',
        700: '#475467',
        800: '#1d2939',
        900: '#101828',
      },
      'primary': {
        25: '#f5f8ff',
        50: '#eff4ff',
        100: '#d1e0ff',
        200: '#b2ccff',
        300: '#84adff',
        400: '#528bff',
        500: '#2970ff',
        600: '#155eef',
        700: '#004eeb',
        800: '#0040c1',
        900: '#00359e',
      },
      'blue': {
        ...theme.colors?.blue,
        500: '#E1EFFE',
      },
      'green': {
        ...theme.colors?.green,
        50: '#F3FAF7',
        100: '#DEF7EC',
        800: '#03543F',
      },
      'yellow': {
        ...theme.colors?.yellow,
        100: '#FDF6B2',
        800: '#723B13',
      },
      'purple': {
        ...theme.colors?.purple,
        50: '#F6F5FF',
        200: '#DCD7FE',
      },
      'indigo': {
        ...theme.colors?.indigo,
        25: '#F5F8FF',
        50: '#EEF4FF',
        100: '#E0EAFF',
        300: '#A4BCFD',
        400: '#8098F9',
        600: '#444CE7',
        800: '#2D31A6',
      },
      'background-gradient-bg-fill-chat-bubble-bg-3': 'var(--color-background-gradient-bg-fill-chat-bubble-bg-3)',
      ...tailwindThemeVarDefine,
    }
    theme.boxShadow = {
      ...theme.boxShadow,
      'xs': '0px 1px 2px 0px rgba(16, 24, 40, 0.05)',
      'sm': '0px 1px 2px 0px rgba(16, 24, 40, 0.06), 0px 1px 3px 0px rgba(16, 24, 40, 0.10)',
      'sm-no-bottom': '0px -1px 2px 0px rgba(16, 24, 40, 0.06), 0px -1px 3px 0px rgba(16, 24, 40, 0.10)',
      'md': '0px 2px 4px -2px rgba(16, 24, 40, 0.06), 0px 4px 8px -2px rgba(16, 24, 40, 0.10)',
      'lg': '0px 4px 6px -2px rgba(16, 24, 40, 0.03), 0px 12px 16px -4px rgba(16, 24, 40, 0.08)',
      'xl': '0px 8px 8px -4px rgba(16, 24, 40, 0.03), 0px 20px 24px -4px rgba(16, 24, 40, 0.08)',
      '2xl': '0px 24px 48px -12px rgba(16, 24, 40, 0.18)',
      '3xl': '0px 32px 64px -12px rgba(16, 24, 40, 0.14)',
      'status-indicator-green-shadow': '0px 2px 6px 0px var(--color-components-badge-status-light-success-halo), 0px 0px 0px 1px var(--color-components-badge-status-light-border-outer)',
      'status-indicator-warning-shadow': '0px 2px 6px 0px var(--color-components-badge-status-light-warning-halo), 0px 0px 0px 1px var(--color-components-badge-status-light-border-outer)',
      'status-indicator-red-shadow': '0px 2px 6px 0px var(--color-components-badge-status-light-error-halo), 0px 0px 0px 1px var(--color-components-badge-status-light-border-outer)',
      'status-indicator-blue-shadow': '0px 2px 6px 0px var(--color-components-badge-status-light-normal-halo), 0px 0px 0px 1px var(--color-components-badge-status-light-border-outer)',
      'status-indicator-gray-shadow': '0px 1px 2px 0px var(--color-components-badge-status-light-disabled-halo), 0px 0px 0px 1px var(--color-components-badge-status-light-border-outer)',
    }
    theme.opacity = {
      ...theme.opacity,
      2: '0.02',
      8: '0.08',
    }
    theme.fontSize = {
      ...theme.fontSize,
      '2xs': '0.625rem',
    }
    theme.backgroundImage = {
      ...theme.backgroundImage,
      'chatbot-bg': 'var(--color-chatbot-bg)',
      'chat-bubble-bg': 'var(--color-chat-bubble-bg)',
      'chat-input-mask': 'var(--color-chat-input-mask)',
      'workflow-process-bg': 'var(--color-workflow-process-bg)',
      'workflow-process-paused-bg': 'var(--color-workflow-process-paused-bg)',
      'workflow-run-failed-bg': 'var(--color-workflow-run-failed-bg)',
      'workflow-batch-failed-bg': 'var(--color-workflow-batch-failed-bg)',
      'mask-top2bottom-gray-50-to-transparent': 'var(--mask-top2bottom-gray-50-to-transparent)',
      'marketplace-divider-bg': 'var(--color-marketplace-divider-bg)',
      'marketplace-plugin-empty': 'var(--color-marketplace-plugin-empty)',
      'toast-success-bg': 'var(--color-toast-success-bg)',
      'toast-warning-bg': 'var(--color-toast-warning-bg)',
      'toast-error-bg': 'var(--color-toast-error-bg)',
      'toast-info-bg': 'var(--color-toast-info-bg)',
      'app-detail-bg': 'var(--color-app-detail-bg)',
      'app-detail-overlay-bg': 'var(--color-app-detail-overlay-bg)',
      'dataset-chunk-process-success-bg': 'var(--color-dataset-chunk-process-success-bg)',
      'dataset-chunk-process-error-bg': 'var(--color-dataset-chunk-process-error-bg)',
      'dataset-chunk-detail-card-hover-bg': 'var(--color-dataset-chunk-detail-card-hover-bg)',
      'dataset-child-chunk-expand-btn-bg': 'var(--color-dataset-child-chunk-expand-btn-bg)',
      'dataset-option-card-blue-gradient': 'var(--color-dataset-option-card-blue-gradient)',
      'dataset-option-card-purple-gradient': 'var(--color-dataset-option-card-purple-gradient)',
      'dataset-option-card-orange-gradient': 'var(--color-dataset-option-card-orange-gradient)',
      'dataset-chunk-list-mask-bg': 'var(--color-dataset-chunk-list-mask-bg)',
      'line-divider-bg': 'var(--color-line-divider-bg)',
      'dataset-warning-message-bg': 'var(--color-dataset-warning-message-bg)',
      'price-premium-badge-background': 'var(--color-premium-badge-background)',
      'premium-yearly-tip-text-background': 'var(--color-premium-yearly-tip-text-background)',
      'price-premium-text-background': 'var(--color-premium-text-background)',
      'price-enterprise-background': 'var(--color-price-enterprise-background)',
      'grid-mask-background': 'var(--color-grid-mask-background)',
      'node-data-source-bg': 'var(--color-node-data-source-bg)',
      'tag-selector-mask-bg': 'var(--color-tag-selector-mask-bg)',
      'tag-selector-mask-hover-bg': 'var(--color-tag-selector-mask-hover-bg)',
      'pipeline-template-card-hover-bg': 'var(--color-pipeline-template-card-hover-bg)',
      'pipeline-add-documents-title-bg': 'var(--color-pipeline-add-documents-title-bg)',
      'billing-plan-title-bg': 'var(--color-billing-plan-title-bg)',
      'billing-plan-card-premium-bg': 'var(--color-billing-plan-card-premium-bg)',
      'billing-plan-card-enterprise-bg': 'var(--color-billing-plan-card-enterprise-bg)',
      'knowledge-pipeline-creation-footer-bg': 'var(--color-knowledge-pipeline-creation-footer-bg)',
      'progress-bar-indeterminate-stripe': 'var(--color-progress-bar-indeterminate-stripe)',
      'chat-answer-human-input-form-divider-bg': 'var(--color-chat-answer-human-input-form-divider-bg)',
    }
    theme.animation = {
      ...theme.animation,
      'spin-slow': 'spin 2s linear infinite',
    }

    return theme
  },
})
