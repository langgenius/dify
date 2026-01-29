import type { IconifyJSON } from '@iconify/types'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getIconCollections, iconsPlugin } from '@egoist/tailwindcss-icons'
import { cleanupSVG, deOptimisePaths, importDirectorySync, isEmptyColor, parseColors, runSVGO } from '@iconify/tools'
import { compareColors, stringToColor } from '@iconify/utils/lib/colors'
import tailwindTypography from '@tailwindcss/typography'
// @ts-expect-error workaround for turbopack issue
import tailwindThemeVarDefine from './themes/tailwind-theme-var-define.ts'
import typography from './typography.js'

const _dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url))

// https://iconify.design/docs/articles/cleaning-up-icons/
function getIconSetFromDir(dir: string, prefix: string) {
  // Import icons
  const iconSet = importDirectorySync(dir, {
    prefix,
    ignoreImportErrors: 'warn',
  })

  // Validate, clean up, fix palette and optimise
  iconSet.forEachSync((name, type) => {
    if (type !== 'icon')
      return

    const svg = iconSet.toSVG(name)
    if (!svg) {
      // Invalid icon
      iconSet.remove(name)
      return
    }

    // Clean up and optimise icons
    try {
      // Clean up icon code
      cleanupSVG(svg)

      // Change color to `currentColor`
      // Skip this step if icon has hardcoded palette
      const blackColor = stringToColor('black')!
      const whiteColor = stringToColor('white')!
      parseColors(svg, {
        defaultColor: 'currentColor',
        callback: (attr, colorStr, color) => {
          if (!color) {
            // Color cannot be parsed!
            throw new Error(`Invalid color: "${colorStr}" in attribute ${attr}`)
          }

          if (isEmptyColor(color)) {
            // Color is empty: 'none' or 'transparent'. Return as is
            return color
          }

          // Change black to 'currentColor'
          if (compareColors(color, blackColor))
            return 'currentColor'

          // Remove shapes with white color
          if (compareColors(color, whiteColor))
            return 'remove'

          // Icon is not monotone
          return color
        },
      })

      // Optimise
      runSVGO(svg)

      // Update paths for compatibility with old software
      deOptimisePaths(svg)
    }
    catch (err) {
      // Invalid icon
      console.error(`Error parsing ${name}:`, err)
      iconSet.remove(name)
      return
    }

    // Update icon
    iconSet.fromSVG(name, svg)
  })

  // Export
  return iconSet.export()
}

function getCollectionsFromSubDirs(baseDir: string, prefixBase: string): Record<string, IconifyJSON> {
  const collections: Record<string, IconifyJSON> = {}

  function processDir(dir: string, prefix: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const subDirs = entries.filter(e => e.isDirectory())
    const svgFiles = entries.filter(e => e.isFile() && e.name.endsWith('.svg'))

    // Process SVG files in current directory if any
    if (svgFiles.length > 0) {
      collections[prefix] = getIconSetFromDir(dir, prefix)
    }

    // Recurse into subdirectories if any
    if (subDirs.length > 0) {
      for (const subDir of subDirs) {
        const subDirPath = path.join(dir, subDir.name)
        const subPrefix = `${prefix}-${subDir.name}`
        processDir(subDirPath, subPrefix)
      }
    }
  }

  // Read top-level subdirectories and process each
  const entries = fs.readdirSync(baseDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subDirPath = path.join(baseDir, entry.name)
      const prefix = `${prefixBase}-${entry.name}`
      processDir(subDirPath, prefix)
    }
  }

  return collections
}

const config = {
  theme: {
    typography,
    extend: {
      colors: {
        gray: {
          25: '#fcfcfd',
          50: '#f9fafb',
          100: '#f2f4f7',
          200: '#eaecf0',
          300: '#d0d5dd',
          400: '#98a2b3',
          500: '#667085',
          700: '#475467',
          600: '#344054',
          800: '#1d2939',
          900: '#101828',
        },
        primary: {
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
        blue: {
          500: '#E1EFFE',
        },
        green: {
          50: '#F3FAF7',
          100: '#DEF7EC',
          800: '#03543F',

        },
        yellow: {
          100: '#FDF6B2',
          800: '#723B13',
        },
        purple: {
          50: '#F6F5FF',
          200: '#DCD7FE',
        },
        indigo: {
          25: '#F5F8FF',
          50: '#EEF4FF',
          100: '#E0EAFF',
          300: '#A4BCFD',
          400: '#8098F9',
          600: '#444CE7',
          800: '#2D31A6',
        },
        ...tailwindThemeVarDefine,
      },
      screens: {
        'mobile': '100px',
        // => @media (min-width: 100px) { ... }
        'tablet': '640px', // 391
        // => @media (min-width: 600px) { ... }
        'pc': '769px',
        // => @media (min-width: 769px) { ... }
        '2k': '2560px',
      },
      boxShadow: {
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
      },
      opacity: {
        2: '0.02',
        8: '0.08',
      },
      fontFamily: {
        instrument: ['var(--font-instrument-serif)', 'serif'],
      },
      fontSize: {
        '2xs': '0.625rem',
      },
      backgroundColor: {
        'background-gradient-bg-fill-chat-bubble-bg-3': 'var(--color-background-gradient-bg-fill-chat-bubble-bg-3)',
      },
      backgroundImage: {
        'chatbot-bg': 'var(--color-chatbot-bg)',
        'chat-bubble-bg': 'var(--color-chat-bubble-bg)',
        'chat-input-mask': 'var(--color-chat-input-mask)',
        'workflow-process-bg': 'var(--color-workflow-process-bg)',
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
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'drag-blink': 'drag-blink 400ms ease-in-out infinite',
      },
      keyframes: {
        'drag-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [
    tailwindTypography,
    iconsPlugin({
      collections: {
        ...getCollectionsFromSubDirs(path.resolve(_dirname, 'app/components/base/icons/assets/public'), 'custom-public'),
        ...getCollectionsFromSubDirs(path.resolve(_dirname, 'app/components/base/icons/assets/vender'), 'custom-vender'),
        ...getIconCollections(['heroicons', 'ri']),
      },
      extraProperties: {
        width: '1rem',
        height: '1rem',
        display: 'block',
      },
    }),
  ],
  // https://github.com/tailwindlabs/tailwindcss/discussions/5969
  corePlugins: {
    preflight: false,
  },
}

export default config
