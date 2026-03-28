export const WORKFLOW_THEME_STORAGE_KEY = 'workflow-theme'
export const WORKFLOW_THEME_CHANGE_EVENT = 'workflow-theme-change'

export const WORKFLOW_THEME_VALUES = [
  'default',
  'ocean',
  'sunset',
] as const

export type WorkflowTheme = (typeof WORKFLOW_THEME_VALUES)[number]

const workflowThemeSet = new Set<WorkflowTheme>(WORKFLOW_THEME_VALUES)
let inMemoryWorkflowTheme: WorkflowTheme = 'default'

export const normalizeWorkflowTheme = (value: string | null): WorkflowTheme => {
  if (!value)
    return 'default'

  return workflowThemeSet.has(value as WorkflowTheme)
    ? (value as WorkflowTheme)
    : 'default'
}

export const getWorkflowThemeFromStorage = (): WorkflowTheme => {
  if (typeof window === 'undefined')
    return inMemoryWorkflowTheme

  try {
    const theme = normalizeWorkflowTheme(localStorage.getItem(WORKFLOW_THEME_STORAGE_KEY))
    inMemoryWorkflowTheme = theme
    return theme
  }
  catch {
    return inMemoryWorkflowTheme
  }
}

export const saveWorkflowThemeToStorage = (theme: WorkflowTheme) => {
  const normalizedTheme = normalizeWorkflowTheme(theme)
  const previousTheme = inMemoryWorkflowTheme

  if (previousTheme === normalizedTheme)
    return

  if (typeof window === 'undefined') {
    inMemoryWorkflowTheme = normalizedTheme
    return
  }

  let storedTheme = previousTheme
  try {
    storedTheme = normalizeWorkflowTheme(localStorage.getItem(WORKFLOW_THEME_STORAGE_KEY))
  }
  catch {
    storedTheme = previousTheme
  }

  if (storedTheme === normalizedTheme) {
    inMemoryWorkflowTheme = normalizedTheme
    return
  }

  inMemoryWorkflowTheme = normalizedTheme

  try {
    localStorage.setItem(WORKFLOW_THEME_STORAGE_KEY, normalizedTheme)
  }
  catch {
    // Ignore storage errors (e.g. quota/security) and keep in-memory fallback.
  }

  window.dispatchEvent(new CustomEvent(WORKFLOW_THEME_CHANGE_EVENT, {
    detail: {
      theme: normalizedTheme,
    },
  }))
}
