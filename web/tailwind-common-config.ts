import tailwindThemeVarDefine from './themes/tailwind-theme-var-define'

const config = {
  theme: {
    typography: require('./typography'),
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
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
  // https://github.com/tailwindlabs/tailwindcss/discussions/5969
  corePlugins: {
    preflight: false,
  },
}

export default config
