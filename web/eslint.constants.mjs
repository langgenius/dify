export const NEXT_PLATFORM_RESTRICTED_IMPORT_PATHS = [
  {
    name: 'next',
    message: 'Import Next APIs from the corresponding @/next module instead of next.',
  },
]

export const NEXT_PLATFORM_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ['next/image'],
    message: 'Do not import next/image. Use native img tags instead.',
  },
  {
    group: ['next/font', 'next/font/*'],
    message: 'Do not import next/font. Use the project font styles instead.',
  },
  {
    group: ['next/*', '!next/font', '!next/font/*', '!next/image', '!next/image/*'],
    message: 'Import Next APIs from the corresponding @/next/* module instead of next/*.',
  },
]

export const OVERLAY_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: [
      '**/portal-to-follow-elem',
      '**/portal-to-follow-elem/index',
    ],
    message: 'Deprecated: use semantic overlay primitives from @/app/components/base/ui/ instead. See issue #32767.',
  },
  {
    group: [
      '**/base/tooltip',
      '**/base/tooltip/index',
    ],
    message: 'Deprecated: use @/app/components/base/ui/tooltip instead. See issue #32767.',
  },
  {
    group: [
      '**/base/modal',
      '**/base/modal/index',
      '**/base/modal/modal',
    ],
    message: 'Deprecated: use @/app/components/base/ui/dialog instead. See issue #32767.',
  },
  {
    group: [
      '**/base/select',
      '**/base/select/index',
      '**/base/select/custom',
      '**/base/select/pure',
    ],
    message: 'Deprecated: use @/app/components/base/ui/select instead. See issue #32767.',
  },
  {
    group: [
      '**/base/confirm',
      '**/base/confirm/index',
    ],
    message: 'Deprecated: use @/app/components/base/ui/alert-dialog instead. See issue #32767.',
  },
  {
    group: [
      '**/base/popover',
      '**/base/popover/index',
    ],
    message: 'Deprecated: use @/app/components/base/ui/popover instead. See issue #32767.',
  },
  {
    group: [
      '**/base/dropdown',
      '**/base/dropdown/index',
    ],
    message: 'Deprecated: use @/app/components/base/ui/dropdown-menu instead. See issue #32767.',
  },
  {
    group: [
      '**/base/dialog',
      '**/base/dialog/index',
    ],
    message: 'Deprecated: use @/app/components/base/ui/dialog instead. See issue #32767.',
  },
  {
    group: [
      '**/base/toast',
      '**/base/toast/index',
      '**/base/toast/context',
      '**/base/toast/context/index',
    ],
    message: 'Deprecated: use @/app/components/base/ui/toast instead. See issue #32811.',
  },
]

export const OVERLAY_MIGRATION_LEGACY_BASE_FILES = [
  'app/components/base/chat/chat-with-history/header/mobile-operation-dropdown.tsx',
  'app/components/base/chat/chat-with-history/header/operation.tsx',
  'app/components/base/chat/chat-with-history/inputs-form/view-form-dropdown.tsx',
  'app/components/base/chat/chat-with-history/sidebar/operation.tsx',
  'app/components/base/chat/chat/citation/popup.tsx',
  'app/components/base/chat/chat/citation/progress-tooltip.tsx',
  'app/components/base/chat/chat/citation/tooltip.tsx',
  'app/components/base/chat/embedded-chatbot/inputs-form/view-form-dropdown.tsx',
  'app/components/base/chip/index.tsx',
  'app/components/base/date-and-time-picker/date-picker/index.tsx',
  'app/components/base/date-and-time-picker/time-picker/index.tsx',
  'app/components/base/dropdown/index.tsx',
  'app/components/base/features/new-feature-panel/file-upload/setting-modal.tsx',
  'app/components/base/features/new-feature-panel/text-to-speech/voice-settings.tsx',
  'app/components/base/file-uploader/file-from-link-or-local/index.tsx',
  'app/components/base/image-uploader/chat-image-uploader.tsx',
  'app/components/base/image-uploader/text-generation-image-uploader.tsx',
  'app/components/base/modal/modal.tsx',
  'app/components/base/prompt-editor/plugins/context-block/component.tsx',
  'app/components/base/prompt-editor/plugins/history-block/component.tsx',
  'app/components/base/select/custom.tsx',
  'app/components/base/select/index.tsx',
  'app/components/base/select/pure.tsx',
  'app/components/base/sort/index.tsx',
  'app/components/base/theme-selector.tsx',
  'app/components/base/tooltip/index.tsx',
]

export const HYOBAN_PREFER_TAILWIND_ICONS_OPTIONS = {
  prefix: 'i-',
  propMappings: {
    size: 'size',
    width: 'w',
    height: 'h',
  },
  libraries: [
    {
      prefix: 'i-custom-',
      source: '^@/app/components/base/icons/src/(?<set>(?:public|vender)(?:/.*)?)$',
      name: '^(?<name>.*)$',
    },
    {
      source: '^@remixicon/react$',
      name: '^(?<set>Ri)(?<name>.+)$',
    },
    {
      source: '^@(?<set>heroicons)/react/24/outline$',
      name: '^(?<name>.*)Icon$',
    },
    {
      source: '^@(?<set>heroicons)/react/24/(?<variant>solid)$',
      name: '^(?<name>.*)Icon$',
    },
    {
      source: '^@(?<set>heroicons)/react/(?<variant>\\d+/(?:solid|outline))$',
      name: '^(?<name>.*)Icon$',
    },
  ],
}
