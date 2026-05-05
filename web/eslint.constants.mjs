export const NEXT_PLATFORM_RESTRICTED_IMPORT_PATHS = [
  {
    name: 'next',
    message: 'Import Next APIs from the corresponding @/next module instead of next.',
  },
]

const NEXT_PLATFORM_RESTRICTED_IMPORT_PATTERNS = [
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

const BASE_UI_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: [
      '@base-ui/react',
      '@base-ui/react/*',
    ],
    message: 'Do not import Base UI directly in web. Use @langgenius/dify-ui/* primitives instead.',
  },
]

export const WEB_RESTRICTED_IMPORT_PATTERNS = [
  ...NEXT_PLATFORM_RESTRICTED_IMPORT_PATTERNS,
  ...BASE_UI_RESTRICTED_IMPORT_PATTERNS,
]

export const OVERLAY_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: [
      '**/portal-to-follow-elem',
      '**/portal-to-follow-elem/index',
    ],
    message: 'Deprecated: use semantic overlay primitives from @langgenius/dify-ui (popover / dropdown-menu / tooltip / context-menu) instead. See issue #32767.',
  },
  {
    group: [
      '**/base/tooltip',
      '**/base/tooltip/index',
    ],
    message: 'Deprecated: use @langgenius/dify-ui/tooltip instead. See issue #32767.',
  },
  {
    group: [
      '**/base/modal',
      '**/base/modal/index',
      '**/base/modal/modal',
    ],
    message: 'Deprecated: use @langgenius/dify-ui/dialog instead. See issue #32767.',
  },
  {
    group: [
      '**/base/dialog',
      '**/base/dialog/index',
    ],
    message: 'Deprecated: use @langgenius/dify-ui/dialog instead. See issue #32767.',
  },
]

export const OVERLAY_MIGRATION_LEGACY_BASE_FILES = [
  'app/components/base/chat/chat/citation/progress-tooltip.tsx',
  'app/components/base/chat/chat/citation/tooltip.tsx',
  'app/components/base/chip/index.tsx',
  'app/components/base/modal/modal.tsx',
  'app/components/base/sort/index.tsx',
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
