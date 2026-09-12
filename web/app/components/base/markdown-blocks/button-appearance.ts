import type { ButtonProps } from '@langgenius/dify-ui/button'

type MarkdownButtonAppearance = Pick<ButtonProps, 'size' | 'tone' | 'variant'>

const MARKDOWN_BUTTON_APPEARANCES = {
  primary: { variant: 'primary' },
  warning: { tone: 'destructive', variant: 'primary' },
  secondary: { variant: 'secondary' },
  'secondary-accent': { variant: 'secondary-accent' },
  ghost: { variant: 'ghost' },
  'ghost-accent': { variant: 'ghost-accent' },
  tertiary: { variant: 'tertiary' },
} satisfies Record<string, MarkdownButtonAppearance>

const VALID_BUTTON_SIZES: ReadonlySet<string> = new Set([
  'small',
  'medium',
  'large',
] satisfies Array<NonNullable<ButtonProps['size']>>)

const VALID_BUTTON_TONES: ReadonlySet<string> = new Set(['default', 'destructive'] satisfies Array<
  NonNullable<ButtonProps['tone']>
>)

function isMarkdownButtonVariant(value: string): value is keyof typeof MARKDOWN_BUTTON_APPEARANCES {
  return Object.hasOwn(MARKDOWN_BUTTON_APPEARANCES, value)
}

function isButtonSize(value: string): value is NonNullable<ButtonProps['size']> {
  return VALID_BUTTON_SIZES.has(value)
}

function isButtonTone(value: string): value is NonNullable<ButtonProps['tone']> {
  return VALID_BUTTON_TONES.has(value)
}

function normalizeAttribute(value: unknown) {
  return value == null ? '' : String(value)
}

function getMarkdownButtonAppearance(
  dataVariant: unknown,
  dataSize: unknown,
  dataTone?: unknown,
): MarkdownButtonAppearance {
  const variant = normalizeAttribute(dataVariant)
  const size = normalizeAttribute(dataSize)
  const tone = normalizeAttribute(dataTone)

  return {
    ...(isMarkdownButtonVariant(variant) ? MARKDOWN_BUTTON_APPEARANCES[variant] : undefined),
    ...(isButtonTone(tone) ? { tone } : undefined),
    size: isButtonSize(size) ? size : undefined,
  }
}

export { getMarkdownButtonAppearance }
