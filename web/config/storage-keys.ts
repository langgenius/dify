export const STORAGE_KEYS = {
  LOCAL: {
    SKILL: {
      SIDEBAR_WIDTH: 'skill-sidebar-width',
    },
    GENERATOR: {
      AUTO_GEN_MODEL: 'auto-gen-model',
    },
    WORKFLOW: {
      SANDBOX_RUNTIME_PREFIX: 'workflow:sandbox-runtime:',
    },
  },
  SESSION: {
    GENERATOR: {
      INSTRUCTION_PREFIX: 'improve-instruction-',
    },
    CONTEXT_GENERATE: {
      PREFIX: 'context-gen-',
    },
  },
} as const
