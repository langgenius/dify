import {
  getWorkflowThemeFromStorage,
  normalizeWorkflowTheme,
  saveWorkflowThemeToStorage,
  WORKFLOW_THEME_CHANGE_EVENT,
  WORKFLOW_THEME_STORAGE_KEY,
} from '../theme'

describe('normalizeWorkflowTheme', () => {
  it('returns default when value is null', () => {
    expect(normalizeWorkflowTheme(null)).toBe('default')
  })

  it('returns default when value is empty', () => {
    expect(normalizeWorkflowTheme('')).toBe('default')
  })

  it('returns theme value when it is supported', () => {
    expect(normalizeWorkflowTheme('ocean')).toBe('ocean')
    expect(normalizeWorkflowTheme('sunset')).toBe('sunset')
    expect(normalizeWorkflowTheme('default')).toBe('default')
  })

  it('falls back to default when value is unsupported', () => {
    expect(normalizeWorkflowTheme('neon')).toBe('default')
  })
})

describe('workflow theme storage helpers', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns default from storage when value is empty', () => {
    expect(getWorkflowThemeFromStorage()).toBe('default')
  })

  it('stores theme and dispatches change event', () => {
    const eventSpy = vi.fn()
    window.addEventListener(WORKFLOW_THEME_CHANGE_EVENT, eventSpy)

    saveWorkflowThemeToStorage('ocean')

    expect(localStorage.getItem(WORKFLOW_THEME_STORAGE_KEY)).toBe('ocean')
    expect(getWorkflowThemeFromStorage()).toBe('ocean')
    expect(eventSpy).toHaveBeenCalledTimes(1)

    window.removeEventListener(WORKFLOW_THEME_CHANGE_EVENT, eventSpy)
  })
})
