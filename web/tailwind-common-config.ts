import { icons as customPublicIcons } from '@dify/iconify-collections/custom-public'
import { icons as customVenderIcons } from '@dify/iconify-collections/custom-vender'
import { getIconCollections, iconsPlugin } from '@egoist/tailwindcss-icons'
import difyUIPreset from '@langgenius/dify-ui/tailwind-preset'
import tailwindTypography from '@tailwindcss/typography'
import typography from './typography.js'

const config = {
  presets: [difyUIPreset],
  theme: {
    typography,
    extend: {
      screens: {
        'mobile': '100px',
        'tablet': '640px',
        'pc': '769px',
        '2k': '2560px',
      },
      backgroundColor: {
        'background-gradient-bg-fill-chat-bubble-bg-3': 'var(--color-background-gradient-bg-fill-chat-bubble-bg-3)',
      },
      backgroundImage: {
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
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
      },
    },
  },
  plugins: [
    tailwindTypography,
    iconsPlugin({
      collections: {
        ...getIconCollections(['heroicons', 'ri']),
        'custom-public': customPublicIcons,
        'custom-vender': customVenderIcons,
      },
      extraProperties: {
        width: '1rem',
        height: '1rem',
        display: 'block',
      },
    }),
  ],
  corePlugins: {
    preflight: false,
  },
}

export default config
