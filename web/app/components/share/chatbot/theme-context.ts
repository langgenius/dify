import type { Context } from 'use-context-selector'
import { createContext, useContext } from 'use-context-selector'

export class Theme {
  private chatColorTheme: string | null
  private chatColorThemeInverted: boolean

  public primaryColor = '#1C64F2'
  public backgroundHeaderColorClass = 'bg-gradient-to-r from-blue-600 to-sky-500'
  public headerBorderBottomClass = ''
  public colorFontOnHeaderClass = 'text-white'
  public colorPathOnHeader = 'white'
  public backgroundButtonDefaultColorClass = 'btn-primary'
  public roundedBackgroundColorClass = 'bg-indigo-25'
  public chatBubbleColorClass = 'bg-blue-500'
  public themeContext?: Context<this>

  constructor(chatColorTheme: string | null = null, chatColorThemeInverted = false) {
    this.chatColorTheme = chatColorTheme
    this.chatColorThemeInverted = chatColorThemeInverted
    this.configCustomColor()
    this.configInvertedColor()
  }

  private configCustomColor() {
    if (this.chatColorTheme !== null) {
      this.primaryColor = this.chatColorTheme
      this.backgroundHeaderColorClass = `bg-[${this.primaryColor}]`
      this.backgroundButtonDefaultColorClass = `bg-[${this.primaryColor}]`
      this.roundedBackgroundColorClass = `bg-[${this.primaryColor}]/5`
      this.chatBubbleColorClass = `bg-[${this.primaryColor}]/10`
    }
  }

  private configInvertedColor() {
    if (this.chatColorThemeInverted) {
      this.backgroundHeaderColorClass = 'bg-white'
      this.colorFontOnHeaderClass = `text-[${this.primaryColor}]`
      this.headerBorderBottomClass = 'border-b border-gray-200'
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
    else {
      throw new Error('Theme already built')
    }
  }
}

const ThemeContext = createContext<ThemeBuilder>(new ThemeBuilder())
export const useThemeContext = () => useContext(ThemeContext)
