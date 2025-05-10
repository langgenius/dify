import { createContext, useContext } from 'use-context-selector'
import { hexToRGBA } from './utils'

export class Theme {
  public chatColorTheme: string | null
  public chatColorThemeInverted: boolean

  public primaryColor = '#298df0'
  public backgroundHeaderColorStyle = 'background: var(--color-chatbot-bg)'
  public headerBorderBottomStyle = ''
  public colorFontOnHeaderStyle = 'color: var(--color-text-primary)'
  public colorPathOnHeader = 'text-quaternary'
  public backgroundButtonDefaultColorStyle = 'backgroundColor: #298df0'
  public roundedBackgroundColorStyle = 'backgroundColor: rgb(245 248 255)'
  public chatBubbleColorStyle = 'backgroundColor: rgb(225 239 254)'
  public chatBubbleColor = 'rgb(225 239 254)'

  constructor(chatColorTheme: string | null = null, chatColorThemeInverted = false) {
    this.chatColorTheme = chatColorTheme
    this.chatColorThemeInverted = chatColorThemeInverted
    this.configCustomColor()
    this.configInvertedColor()
  }

  private configCustomColor() {
    if (this.chatColorTheme !== null && this.chatColorTheme !== '') {
      this.primaryColor = this.chatColorTheme ?? '#298df0'
      this.backgroundHeaderColorStyle = `backgroundColor: ${this.primaryColor}`
      this.backgroundButtonDefaultColorStyle = `backgroundColor: ${this.primaryColor}; color: ${this.colorFontOnHeaderStyle};`
      this.roundedBackgroundColorStyle = `backgroundColor: ${hexToRGBA(this.primaryColor, 0.05)}`
      this.chatBubbleColorStyle = `backgroundColor: ${hexToRGBA(this.primaryColor, 0.15)}`
      this.chatBubbleColor = `${hexToRGBA(this.primaryColor, 0.15)}`
    }
  }

  private configInvertedColor() {
    if (this.chatColorThemeInverted) {
      this.backgroundHeaderColorStyle = 'backgroundColor: #ffffff'
      this.colorFontOnHeaderStyle = `color: ${this.primaryColor}`
      this.headerBorderBottomStyle = 'borderBottom: 1px solid #ccc'
      this.colorPathOnHeader = this.primaryColor
    }
  }
}

export class ThemeBuilder {
  private _theme?: Theme
  private buildChecker = false

  public get theme() {
    if (this._theme === undefined) {
      this._theme = new Theme()
      return this._theme
    }
    else {
      return this._theme
    }
  }

  public buildTheme(chatColorTheme: string | null = null, chatColorThemeInverted = false) {
    if (!this.buildChecker) {
      this._theme = new Theme(chatColorTheme, chatColorThemeInverted)
      this.buildChecker = true
    }
    else {
      if (this.theme?.chatColorTheme !== chatColorTheme || this.theme?.chatColorThemeInverted !== chatColorThemeInverted) {
        this._theme = new Theme(chatColorTheme, chatColorThemeInverted)
        this.buildChecker = true
      }
    }
  }
}

const ThemeContext = createContext<ThemeBuilder>(new ThemeBuilder())
export const useThemeContext = () => useContext(ThemeContext)
