import { hexToRGBA } from './utils'

export type Theme = Readonly<{
  chatColorTheme: string | null
  chatColorThemeInverted: boolean
  primaryColor: string
  backgroundHeaderColorStyle: string
  headerBorderBottomStyle: string
  colorFontOnHeaderStyle: string
  colorPathOnHeader: string
  backgroundButtonDefaultColorStyle: string
  roundedBackgroundColorStyle: string
  chatBubbleColorStyle: string
}>

export const createTheme = (
  chatColorTheme: string | null = null,
  chatColorThemeInverted = false,
): Theme => {
  const hasCustomColor = chatColorTheme !== null && chatColorTheme !== ''
  const primaryColor = hasCustomColor ? chatColorTheme : '#1C64F2'
  const colorFontOnHeaderStyle = chatColorThemeInverted ? `color: ${primaryColor}` : 'color: white'

  return Object.freeze({
    chatColorTheme,
    chatColorThemeInverted,
    primaryColor,
    backgroundHeaderColorStyle: chatColorThemeInverted
      ? 'backgroundColor: #ffffff'
      : hasCustomColor
        ? `backgroundColor: ${primaryColor}`
        : 'backgroundImage: linear-gradient(to right, #2563eb, #0ea5e9)',
    headerBorderBottomStyle: chatColorThemeInverted ? 'borderBottom: 1px solid #ccc' : '',
    colorFontOnHeaderStyle,
    colorPathOnHeader: chatColorThemeInverted ? primaryColor : 'text-text-primary-on-surface',
    backgroundButtonDefaultColorStyle: hasCustomColor
      ? `backgroundColor: ${primaryColor}; color: color: white;`
      : 'backgroundColor: #1C64F2',
    roundedBackgroundColorStyle: hasCustomColor
      ? `backgroundColor: ${hexToRGBA(primaryColor, 0.05)}`
      : 'backgroundColor: rgb(245 248 255)',
    chatBubbleColorStyle: hasCustomColor ? `backgroundColor: ${hexToRGBA(primaryColor, 0.15)}` : '',
  })
}
