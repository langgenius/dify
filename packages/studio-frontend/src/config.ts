// Re-export commonly-used config values from the web app config.
// Studio components import from '@' which resolves to web first (tsconfig).
// This file enables a future studio-first path resolution by providing
// the subset of config values that Studio components actually need.
export {
  API_PREFIX,
  APP_PAGE_LIMIT,
  DATASET_DEFAULT,
  DEFAULT_AGENT_PROMPT,
  DEFAULT_AGENT_SETTING,
  DEFAULT_CHAT_PROMPT_CONFIG,
  DEFAULT_COMPLETION_PROMPT_CONFIG,
  IS_CE_EDITION,
  IS_CLOUD_EDITION,
  IS_DEV,
  JSON_SCHEMA_MAX_DEPTH,
  LOOP_NODE_MAX_COUNT,
  MAX_ITERATIONS_NUM,
  MAX_PARALLEL_LIMIT,
  MAX_PROMPT_MESSAGE_LENGTH,
  MAX_TOOLS_NUM,
  MAX_TREE_DEPTH,
  NEED_REFRESH_APP_LIST_KEY,
  ANNOTATION_DEFAULT,
  SOCKET_URL,
  VALUE_SELECTOR_DELIMITER,
  VAR_REGEX,
  appDefaultIconBackground,
} from '../../../web/config/index'
