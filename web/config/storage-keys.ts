export const STORAGE_KEYS = {
  WORKFLOW: {
    NODE_PANEL_WIDTH: 'workflow-node-panel-width',
    PREVIEW_PANEL_WIDTH: 'debug-and-preview-panel-width',
    VARIABLE_INSPECT_PANEL_HEIGHT: 'workflow-variable-inspect-panel-height',
    CANVAS_MAXIMIZE: 'workflow-canvas-maximize',
    OPERATION_MODE: 'workflow-operation-mode',
  },
  APP: {
    SIDEBAR_COLLAPSE: 'webappSidebarCollapse',
    NEED_REFRESH_LIST: 'needRefreshAppList',
    DETAIL_COLLAPSE: 'app-detail-collapse-or-expand',
  },
  CONVERSATION: {
    ID_INFO: 'conversationIdInfo',
  },
  AUTH: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_LOCK: 'is_other_tab_refreshing',
    LAST_REFRESH_TIME: 'last_refresh_time',
  },
  EDUCATION: {
    VERIFYING: 'educationVerifying',
    REVERIFY_PREV_EXPIRE_AT: 'education-reverify-prev-expire-at',
    REVERIFY_HAS_NOTICED: 'education-reverify-has-noticed',
    EXPIRED_HAS_NOTICED: 'education-expired-has-noticed',
  },
  CONFIG: {
    AUTO_GEN_MODEL: 'auto-gen-model',
    DEBUG_MODELS: 'app-debug-with-single-or-multiple-models',
    SETUP_STATUS: 'setup_status',
  },
} as const

export type StorageKeys = typeof STORAGE_KEYS
