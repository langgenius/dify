import { createContext, useContext } from 'use-context-selector'
import { hexToRGBA } from './utils'

export class Theme {
  private chatColorTheme: string | null
  private chatColorThemeInverted: boolean

  public primaryColor = '#1C64F2'
  public backgroundHeaderColorStyle = 'background-image: linear-gradient(to right, #2563eb, #0ea5e9)'
  public headerBorderBottomStyle = ''
  public colorFontOnHeaderStyle = 'color: white'
  public colorPathOnHeader = 'white'
  public backgroundButtonDefaultColorStyle = 'background-color: #1C64F2'
  public roundedBackgroundColorStyle = 'background-color: rgb(245 248 255)'
  public chatBubbleColorStyle = 'background-color: rgb(225 239 254)'

  constructor(chatColorTheme: string | null = null, chatColorThemeInverted = false) {
    this.chatColorTheme = chatColorTheme
    this.chatColorThemeInverted = chatColorThemeInverted
    this.configCustomColor()
    this.configInvertedColor()
  }

  private configCustomColor() {
    if (this.chatColorTheme !== null) {
      this.primaryColor = this.chatColorTheme
      this.backgroundHeaderColorStyle = `background-color: ${this.primaryColor}`
      this.backgroundButtonDefaultColorStyle = `background-color: ${this.primaryColor}`
      this.roundedBackgroundColorStyle = `background-color: ${hexToRGBA(this.primaryColor, 0.05)}`
      this.chatBubbleColorStyle = `background-color: ${hexToRGBA(this.primaryColor, 0.15)}`
    }
  }

  private configInvertedColor() {
    if (this.chatColorThemeInverted) {
      this.backgroundHeaderColorStyle = 'background-color: #ffffff'
      this.colorFontOnHeaderStyle = `color: ${this.primaryColor}`
      this.headerBorderBottomStyle = 'border: 1px solid #ccc'
      this.colorPathOnHeader = this.primaryColor
    }
  }
}

export class ThemeBuilder {
  public theme: Theme | null = null
  private buildChecker = false

  public buildTheme(chatColorTheme: string | null = null, chatColorThemeInverted = false) {
    if (!this.buildChecker) {
      this.theme = new Theme(chatColorTheme, chatColorThemeInverted)
      this.buildChecker = true
    }
  }
}

const ThemeContext = createContext<ThemeBuilder>(new ThemeBuilder())
export const useThemeContext = () => useContext(ThemeContext)
