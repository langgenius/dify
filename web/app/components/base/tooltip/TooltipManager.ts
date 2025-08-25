class TooltipManager {
  private activeCloser: (() => void) | null = null

  register(closeFn: () => void) {
    if (this.activeCloser)
      this.activeCloser()
    this.activeCloser = closeFn
  }

  clear(closeFn: () => void) {
    if (this.activeCloser === closeFn)
      this.activeCloser = null
  }
}

export const tooltipManager = new TooltipManager()
