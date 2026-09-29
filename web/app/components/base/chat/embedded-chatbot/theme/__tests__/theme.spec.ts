import { createTheme } from '../theme'

describe('createTheme', () => {
  it('uses the default palette when no custom color is configured', () => {
    const theme = createTheme()

    expect(theme).toMatchObject({
      chatColorTheme: null,
      chatColorThemeInverted: false,
      primaryColor: '#1C64F2',
      backgroundHeaderColorStyle: 'backgroundImage: linear-gradient(to right, #2563eb, #0ea5e9)',
      headerBorderBottomStyle: '',
      colorFontOnHeaderStyle: 'color: white',
      colorPathOnHeader: 'text-text-primary-on-surface',
      backgroundButtonDefaultColorStyle: 'backgroundColor: #1C64F2',
      roundedBackgroundColorStyle: 'backgroundColor: rgb(245 248 255)',
      chatBubbleColorStyle: '',
    })
  })

  it('treats an empty custom color as the default palette', () => {
    expect(createTheme('')).toMatchObject({
      chatColorTheme: '',
      primaryColor: '#1C64F2',
      backgroundHeaderColorStyle: 'backgroundImage: linear-gradient(to right, #2563eb, #0ea5e9)',
      chatBubbleColorStyle: '',
    })
  })

  it('derives the custom palette without mutating another theme', () => {
    const firstTheme = createTheme('#FF5733')
    const secondTheme = createTheme('#123456')

    expect(firstTheme).toMatchObject({
      chatColorTheme: '#FF5733',
      primaryColor: '#FF5733',
      backgroundHeaderColorStyle: 'backgroundColor: #FF5733',
      backgroundButtonDefaultColorStyle: 'backgroundColor: #FF5733; color: color: white;',
      roundedBackgroundColorStyle: 'backgroundColor: rgba(255,87,51,0.05)',
      chatBubbleColorStyle: 'backgroundColor: rgba(255,87,51,0.15)',
    })
    expect(secondTheme.primaryColor).toBe('#123456')
    expect(firstTheme.primaryColor).toBe('#FF5733')
    expect(Object.isFrozen(firstTheme)).toBe(true)
    expect(Reflect.set(firstTheme, 'primaryColor', '#000000')).toBe(false)
    expect(firstTheme.primaryColor).toBe('#FF5733')
  })

  it('derives the inverted palette from the configured primary color', () => {
    expect(createTheme('#FF5733', true)).toMatchObject({
      chatColorThemeInverted: true,
      primaryColor: '#FF5733',
      backgroundHeaderColorStyle: 'backgroundColor: #ffffff',
      headerBorderBottomStyle: 'borderBottom: 1px solid #ccc',
      colorFontOnHeaderStyle: 'color: #FF5733',
      colorPathOnHeader: '#FF5733',
    })
  })
})
