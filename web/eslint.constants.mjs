export const GENERATED_IGNORES = [
  'storybook-static/',
  '.next/',
  '.vinext/',
  'next/',
  'next-env.d.ts',
  'dist/',
  'coverage/',
]

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
    group: ['@base-ui/react', '@base-ui/react/*'],
    message: 'Do not import Base UI directly in web. Use @langgenius/dify-ui/* primitives instead.',
  },
]

const FLOATING_UI_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ['@floating-ui/*'],
    message:
      'Do not import Floating UI directly in web. Use @langgenius/dify-ui/* primitives instead.',
  },
]

const LEGACY_WEB_INPUT_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ['**/base/input', '**/base/input/*'],
    message:
      'Do not import the deprecated web base Input. Use @langgenius/dify-ui/input for standalone inputs, and @langgenius/dify-ui/field for labelled or validated form composition.',
  },
]

const LEGACY_SERVICE_BASE_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ['@/service/base', '@/service/base/*', '**/service/base', '**/service/base/*'],
    message:
      'Do not import legacy service/base fetch helpers. Use generated service clients or feature-specific service modules instead.',
  },
]

const LEGACY_SERVICE_FETCH_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ['@/service/fetch', '@/service/fetch/*', '**/service/fetch', '**/service/fetch/*'],
    message:
      'Do not import low-level service/fetch helpers directly. Use generated service clients or feature-specific service modules instead.',
  },
]

export const WEB_SERVICE_BASE_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ['./base', './base/*', '../base', '../base/*', '../../base', '../../base/*'],
    message:
      'Do not import legacy service/base fetch helpers. Use generated service clients or feature-specific service modules instead.',
  },
]

export const WEB_SERVICE_FETCH_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ['./fetch', './fetch/*', '../fetch', '../fetch/*', '../../fetch', '../../fetch/*'],
    message:
      'Do not import low-level service/fetch helpers directly. Use generated service clients or feature-specific service modules instead.',
  },
]

export const WEB_RESTRICTED_IMPORT_PATTERNS = [
  ...NEXT_PLATFORM_RESTRICTED_IMPORT_PATTERNS,
  ...BASE_UI_RESTRICTED_IMPORT_PATTERNS,
  ...FLOATING_UI_RESTRICTED_IMPORT_PATTERNS,
  ...LEGACY_WEB_INPUT_RESTRICTED_IMPORT_PATTERNS,
  ...LEGACY_SERVICE_BASE_RESTRICTED_IMPORT_PATTERNS,
  ...LEGACY_SERVICE_FETCH_RESTRICTED_IMPORT_PATTERNS,
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
