// Floors were set from the app/components baseline captured on 2026-03-13,
// with a small buffer to avoid CI noise on existing code.
export const EXCLUDED_COMPONENT_MODULES = new Set([
  'devtools',
  'provider',
])

export const COMPONENTS_GLOBAL_THRESHOLDS = {
  lines: 58,
  statements: 58,
  functions: 58,
  branches: 54,
}

export const COMPONENT_MODULE_THRESHOLDS = {
  'app': {
    lines: 45,
    statements: 45,
    functions: 50,
    branches: 35,
  },
  'app-sidebar': {
    lines: 95,
    statements: 95,
    functions: 95,
    branches: 90,
  },
  'apps': {
    lines: 90,
    statements: 90,
    functions: 85,
    branches: 80,
  },
  'base': {
    lines: 95,
    statements: 95,
    functions: 90,
    branches: 95,
  },
  'billing': {
    lines: 95,
    statements: 95,
    functions: 95,
    branches: 95,
  },
  'custom': {
    lines: 70,
    statements: 70,
    functions: 70,
    branches: 80,
  },
  'datasets': {
    lines: 95,
    statements: 95,
    functions: 95,
    branches: 90,
  },
  'develop': {
    lines: 95,
    statements: 95,
    functions: 95,
    branches: 90,
  },
  'explore': {
    lines: 95,
    statements: 95,
    functions: 95,
    branches: 85,
  },
  'goto-anything': {
    lines: 90,
    statements: 90,
    functions: 90,
    branches: 90,
  },
  'header': {
    lines: 95,
    statements: 95,
    functions: 95,
    branches: 95,
  },
  'plugins': {
    lines: 90,
    statements: 90,
    functions: 90,
    branches: 85,
  },
  'rag-pipeline': {
    lines: 95,
    statements: 95,
    functions: 95,
    branches: 90,
  },
  'share': {
    lines: 95,
    statements: 95,
    functions: 95,
    branches: 95,
  },
  'signin': {
    lines: 95,
    statements: 95,
    functions: 95,
    branches: 95,
  },
  'tools': {
    lines: 95,
    statements: 95,
    functions: 90,
    branches: 90,
  },
  'workflow': {
    lines: 15,
    statements: 15,
    functions: 10,
    branches: 10,
  },
  'workflow-app': {
    lines: 20,
    statements: 20,
    functions: 25,
    branches: 15,
  },
}

export function getComponentModuleThreshold(moduleName) {
  return COMPONENT_MODULE_THRESHOLDS[moduleName] ?? null
}
