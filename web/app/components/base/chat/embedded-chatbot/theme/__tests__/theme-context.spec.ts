import { renderHook } from '@testing-library/react'
import { Theme, ThemeBuilder, useThemeContext } from '../theme-context'

// Scenario: Theme class configures colors from chatColorTheme and chatColorThemeInverted flags.
describe('Theme', () => {
  describe('Default colors', () => {
    it('should use default primary color when chatColorTheme is null', () => {
      const theme = new Theme(null, false)

      expect(theme.primaryColor).toBe('#1C64F2')
    })

    it('should use gradient background header when chatColorTheme is null', () => {
      const theme = new Theme(null, false)

      expect(theme.backgroundHeaderColorStyle).toBe(
        'backgroundImage: linear-gradient(to right, #2563eb, #0ea5e9)',
      )
    })

    it('should have empty chatBubbleColorStyle when chatColorTheme is null', () => {
      const theme = new Theme(null, false)

      expect(theme.chatBubbleColorStyle).toBe('')
    })

    it('should use default colors when chatColorTheme is empty string', () => {
      const theme = new Theme('', false)

      expect(theme.primaryColor).toBe('#1C64F2')
      expect(theme.backgroundHeaderColorStyle).toBe(
        'backgroundImage: linear-gradient(to right, #2563eb, #0ea5e9)',
      )
    })
  })

  describe('Custom color (configCustomColor)', () => {
    it('should set primaryColor to chatColorTheme value', () => {
      const theme = new Theme('#FF5733', false)

      expect(theme.primaryColor).toBe('#FF5733')
    })

    it('should set backgroundHeaderColorStyle to solid custom color', () => {
      const theme = new Theme('#FF5733', false)

      expect(theme.backgroundHeaderColorStyle).toBe('backgroundColor: #FF5733')
    })

    it('should include primary color in backgroundButtonDefaultColorStyle', () => {
      const theme = new Theme('#FF5733', false)

      expect(theme.backgroundButtonDefaultColorStyle).toContain('#FF5733')
    })

    it('should set roundedBackgroundColorStyle with 5% opacity rgba', () => {
      const theme = new Theme('#FF5733', false)

      // #FF5733 → r=255 g=87 b=51
      expect(theme.roundedBackgroundColorStyle).toBe('backgroundColor: rgba(255,87,51,0.05)')
    })

    it('should set chatBubbleColorStyle with 15% opacity rgba', () => {
      const theme = new Theme('#FF5733', false)

      expect(theme.chatBubbleColorStyle).toBe('backgroundColor: rgba(255,87,51,0.15)')
    })
  })

  describe('Inverted color (configInvertedColor)', () => {
    it('should use white background header when inverted with no custom color', () => {
      const theme = new Theme(null, true)

      expect(theme.backgroundHeaderColorStyle).toBe('backgroundColor: #ffffff')
    })

    it('should set colorFontOnHeaderStyle to default primaryColor when inverted with no custom color', () => {
      const theme = new Theme(null, true)

      expect(theme.colorFontOnHeaderStyle).toBe('color: #1C64F2')
    })

    it('should set headerBorderBottomStyle when inverted', () => {
      const theme = new Theme(null, true)

      expect(theme.headerBorderBottomStyle).toBe('borderBottom: 1px solid #ccc')
    })

    it('should set colorPathOnHeader to primaryColor when inverted', () => {
      const theme = new Theme(null, true)

      expect(theme.colorPathOnHeader).toBe('#1C64F2')
    })

    it('should have empty headerBorderBottomStyle when not inverted', () => {
      const theme = new Theme(null, false)

      expect(theme.headerBorderBottomStyle).toBe('')
    })
  })

  describe('Custom color + inverted combined', () => {
    it('should override background to white even when custom color is set', () => {
      const theme = new Theme('#FF5733', true)

      // configCustomColor runs first (solid bg), then configInvertedColor overrides to white
      expect(theme.backgroundHeaderColorStyle).toBe('backgroundColor: #ffffff')
    })

    it('should use custom primaryColor for colorFontOnHeaderStyle when inverted', () => {
      const theme = new Theme('#FF5733', true)

      expect(theme.colorFontOnHeaderStyle).toBe('color: #FF5733')
    })

    it('should set colorPathOnHeader to custom primaryColor when inverted', () => {
      const theme = new Theme('#FF5733', true)

      expect(theme.colorPathOnHeader).toBe('#FF5733')
    })
  })
})

// Scenario: ThemeBuilder manages a lazily-created Theme instance and rebuilds on config change.
describe('ThemeBuilder', () => {
  describe('theme getter', () => {
    it('should create a default Theme when _theme is undefined (first access)', () => {
      const builder = new ThemeBuilder()

      const theme = builder.theme

      expect(theme).toBeInstanceOf(Theme)
      expect(theme.primaryColor).toBe('#1C64F2')
    })

    it('should return the same Theme instance on subsequent accesses', () => {
      const builder = new ThemeBuilder()

      const first = builder.theme
      const second = builder.theme

      expect(first).toBe(second)
    })
  })

  describe('buildTheme', () => {
    it('should create a Theme with the given color on first call', () => {
      const builder = new ThemeBuilder()

      builder.buildTheme('#AABBCC', false)

      expect(builder.theme.primaryColor).toBe('#AABBCC')
    })

    it('should not rebuild the Theme when called again with the same config', () => {
      const builder = new ThemeBuilder()
      builder.buildTheme('#AABBCC', false)
      const themeAfterFirstBuild = builder.theme

      builder.buildTheme('#AABBCC', false)

      // Same instance: no rebuild occurred
      expect(builder.theme).toBe(themeAfterFirstBuild)
    })

    it('should rebuild the Theme when chatColorTheme changes', () => {
      const builder = new ThemeBuilder()
      builder.buildTheme('#AABBCC', false)
      const originalTheme = builder.theme

      builder.buildTheme('#FF0000', false)

      expect(builder.theme).not.toBe(originalTheme)
      expect(builder.theme.primaryColor).toBe('#FF0000')
    })

    it('should rebuild the Theme when chatColorThemeInverted changes', () => {
      const builder = new ThemeBuilder()
      builder.buildTheme('#AABBCC', false)
      const originalTheme = builder.theme

      builder.buildTheme('#AABBCC', true)

      expect(builder.theme).not.toBe(originalTheme)
      expect(builder.theme.chatColorThemeInverted).toBe(true)
    })

    it('should use default args (null, false) when called with no arguments', () => {
      const builder = new ThemeBuilder()

      builder.buildTheme()

      expect(builder.theme.chatColorTheme).toBeNull()
      expect(builder.theme.chatColorThemeInverted).toBe(false)
    })

    it('should store chatColorTheme and chatColorThemeInverted on the built Theme', () => {
      const builder = new ThemeBuilder()

      builder.buildTheme('#123456', true)

      expect(builder.theme.chatColorTheme).toBe('#123456')
      expect(builder.theme.chatColorThemeInverted).toBe(true)
    })
  })
})

// Scenario: useThemeContext returns a ThemeBuilder from the nearest ThemeContext.
describe('useThemeContext', () => {
  it('should return a ThemeBuilder instance from the default context', () => {
    const { result } = renderHook(() => useThemeContext())

    expect(result.current).toBeInstanceOf(ThemeBuilder)
  })

  it('should expose a valid theme on the returned ThemeBuilder', () => {
    const { result } = renderHook(() => useThemeContext())

    expect(result.current.theme).toBeInstanceOf(Theme)
  })
})
