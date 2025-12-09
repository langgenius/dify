import { InputVarType } from '@/app/components/workflow/types'
import { AgentStrategy } from '@/types/app'
import { PromptRole } from '@/models/debug'
import { PipelineInputVarType } from '@/models/pipeline'
import { DatasetAttr } from '@/types/feature'
import pkg from '../package.json'
import type { ModelParameterRule } from '@/app/components/header/account-setting/model-provider-page/declarations'

const getBooleanConfig = (
  envVar: string | undefined,
  dataAttrKey: DatasetAttr,
  defaultValue: boolean = true,
) => {
  if (envVar !== undefined && envVar !== '') return envVar === 'true'
  const attrValue = globalThis.document?.body?.getAttribute(dataAttrKey)
  if (attrValue !== undefined && attrValue !== '') return attrValue === 'true'
  return defaultValue
}

const getNumberConfig = (
  envVar: string | undefined,
  dataAttrKey: DatasetAttr,
  defaultValue: number,
) => {
  if (envVar) {
    const parsed = Number.parseInt(envVar)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }

  const attrValue = globalThis.document?.body?.getAttribute(dataAttrKey)
  if (attrValue) {
    const parsed = Number.parseInt(attrValue)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  return defaultValue
}

const getStringConfig = (
  envVar: string | undefined,
  dataAttrKey: DatasetAttr,
  defaultValue: string,
) => {
  if (envVar) return envVar

  const attrValue = globalThis.document?.body?.getAttribute(dataAttrKey)
  if (attrValue) return attrValue
  return defaultValue
}

export const API_PREFIX = getStringConfig(
  process.env.NEXT_PUBLIC_API_PREFIX,
  DatasetAttr.DATA_API_PREFIX,
  'http://localhost:5001/console/api',
)
export const PUBLIC_API_PREFIX = getStringConfig(
  process.env.NEXT_PUBLIC_PUBLIC_API_PREFIX,
  DatasetAttr.DATA_PUBLIC_API_PREFIX,
  'http://localhost:5001/api',
)
export const MARKETPLACE_API_PREFIX = getStringConfig(
  process.env.NEXT_PUBLIC_MARKETPLACE_API_PREFIX,
  DatasetAttr.DATA_MARKETPLACE_API_PREFIX,
  'http://localhost:5002/api',
)
export const MARKETPLACE_URL_PREFIX = getStringConfig(
  process.env.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX,
  DatasetAttr.DATA_MARKETPLACE_URL_PREFIX,
  '',
)

const EDITION = getStringConfig(
  process.env.NEXT_PUBLIC_EDITION,
  DatasetAttr.DATA_PUBLIC_EDITION,
  'SELF_HOSTED',
)

export const IS_CE_EDITION = EDITION === 'SELF_HOSTED'
export const IS_CLOUD_EDITION = EDITION === 'CLOUD'

export const IS_DEV = process.env.NODE_ENV === 'development'
export const IS_PROD = process.env.NODE_ENV === 'production'

export const SUPPORT_MAIL_LOGIN = !!(
  process.env.NEXT_PUBLIC_SUPPORT_MAIL_LOGIN
  || globalThis.document?.body?.getAttribute('data-public-support-mail-login')
)

export const TONE_LIST = [
  {
    id: 1,
    name: 'Creative',
    config: {
      temperature: 0.8,
      top_p: 0.9,
      presence_penalty: 0.1,
      frequency_penalty: 0.1,
    },
  },
  {
    id: 2,
    name: 'Balanced',
    config: {
      temperature: 0.5,
      top_p: 0.85,
      presence_penalty: 0.2,
      frequency_penalty: 0.3,
    },
  },
  {
    id: 3,
    name: 'Precise',
    config: {
      temperature: 0.2,
      top_p: 0.75,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
    },
  },
  {
    id: 4,
    name: 'Custom',
  },
]

export const DEFAULT_CHAT_PROMPT_CONFIG = {
  prompt: [
    {
      role: PromptRole.system,
      text: '',
    },
  ],
}

export const DEFAULT_COMPLETION_PROMPT_CONFIG = {
  prompt: {
    text: '',
  },
  conversation_histories_role: {
    user_prefix: '',
    assistant_prefix: '',
  },
}

export const getMaxToken = (modelId: string) => {
  return modelId === 'gpt-4' || modelId === 'gpt-3.5-turbo-16k' ? 8000 : 4000
}

export const LOCALE_COOKIE_NAME = 'locale'

const COOKIE_DOMAIN = getStringConfig(
  process.env.NEXT_PUBLIC_COOKIE_DOMAIN,
  DatasetAttr.DATA_PUBLIC_COOKIE_DOMAIN,
  '',
).trim()
export const CSRF_COOKIE_NAME = () => {
  if (COOKIE_DOMAIN) return 'csrf_token'
  const isSecure = API_PREFIX.startsWith('https://')
  return isSecure ? '__Host-csrf_token' : 'csrf_token'
}
export const CSRF_HEADER_NAME = 'X-CSRF-Token'
export const ACCESS_TOKEN_LOCAL_STORAGE_NAME = 'access_token'
export const PASSPORT_LOCAL_STORAGE_NAME = (appCode: string) => `passport-${appCode}`
export const PASSPORT_HEADER_NAME = 'X-App-Passport'

export const WEB_APP_SHARE_CODE_HEADER_NAME = 'X-App-Code'

export const DEFAULT_VALUE_MAX_LEN = 48
export const DEFAULT_PARAGRAPH_VALUE_MAX_LEN = 1000

export const zhRegex = /^[\u4E00-\u9FA5]$/m
export const emojiRegex = /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/m
export const emailRegex = /^[\w.!#$%&'*+\-/=?^{|}~]+@([\w-]+\.)+[\w-]{2,}$/m
const MAX_ZN_VAR_NAME_LENGTH = 8
const MAX_EN_VAR_VALUE_LENGTH = 30
export const getMaxVarNameLength = (value: string) => {
  if (zhRegex.test(value)) return MAX_ZN_VAR_NAME_LENGTH

  return MAX_EN_VAR_VALUE_LENGTH
}

export const MAX_VAR_KEY_LENGTH = 30

export const MAX_PROMPT_MESSAGE_LENGTH = 10

export const VAR_ITEM_TEMPLATE = {
  key: '',
  name: '',
  type: 'string',
  max_length: DEFAULT_VALUE_MAX_LEN,
  required: true,
}

export const VAR_ITEM_TEMPLATE_IN_WORKFLOW = {
  variable: '',
  label: '',
  type: InputVarType.textInput,
  max_length: DEFAULT_VALUE_MAX_LEN,
  required: true,
  options: [],
}

export const VAR_ITEM_TEMPLATE_IN_PIPELINE = {
  variable: '',
  label: '',
  type: PipelineInputVarType.textInput,
  max_length: DEFAULT_VALUE_MAX_LEN,
  required: true,
  options: [],
}

export const appDefaultIconBackground = '#D5F5F6'

export const NEED_REFRESH_APP_LIST_KEY = 'needRefreshAppList'

export const DATASET_DEFAULT = {
  top_k: 4,
  score_threshold: 0.8,
}

export const APP_PAGE_LIMIT = 10

export const ANNOTATION_DEFAULT = {
  score_threshold: 0.9,
}

export const DEFAULT_AGENT_SETTING = {
  enabled: false,
  max_iteration: 10,
  strategy: AgentStrategy.functionCall,
  tools: [],
}

export const DEFAULT_AGENT_PROMPT = {
  chat: `Respond to the human as helpfully and accurately as possible.

{{instruction}}

You have access to the following tools:

{{tools}}

Use a json blob to specify a tool by providing an {{TOOL_NAME_KEY}} key (tool name) and an {{ACTION_INPUT_KEY}} key (tool input).
Valid "{{TOOL_NAME_KEY}}" values: "Final Answer" or {{tool_names}}

Provide only ONE action per $JSON_BLOB, as shown:

\`\`\`
{
  "{{TOOL_NAME_KEY}}": $TOOL_NAME,
  "{{ACTION_INPUT_KEY}}": $ACTION_INPUT
}
\`\`\`

Follow this format:

Question: input question to answer
Thought: consider previous and subsequent steps
Action:
\`\`\`
$JSON_BLOB
\`\`\`
Observation: action result
... (repeat Thought/Action/Observation N times)
Thought: I know what to respond
Action:
\`\`\`
{
  "{{TOOL_NAME_KEY}}": "Final Answer",
  "{{ACTION_INPUT_KEY}}": "Final response to human"
}
\`\`\`

Begin! Reminder to ALWAYS respond with a valid json blob of a single action. Use tools if necessary. Respond directly if appropriate. Format is Action:\`\`\`$JSON_BLOB\`\`\`then Observation:.`,
  completion: `
Respond to the human as helpfully and accurately as possible.

{{instruction}}

You have access to the following tools:

{{tools}}

Use a json blob to specify a tool by providing an {{TOOL_NAME_KEY}} key (tool name) and an {{ACTION_INPUT_KEY}} key (tool input).
Valid "{{TOOL_NAME_KEY}}" values: "Final Answer" or {{tool_names}}

Provide only ONE action per $JSON_BLOB, as shown:

\`\`\`
{{{{
  "{{TOOL_NAME_KEY}}": $TOOL_NAME,
  "{{ACTION_INPUT_KEY}}": $ACTION_INPUT
}}}}
\`\`\`

Follow this format:

Question: input question to answer
Thought: consider previous and subsequent steps
Action:
\`\`\`
$JSON_BLOB
\`\`\`
Observation: action result
... (repeat Thought/Action/Observation N times)
Thought: I know what to respond
Action:
\`\`\`
{{{{
  "{{TOOL_NAME_KEY}}": "Final Answer",
  "{{ACTION_INPUT_KEY}}": "Final response to human"
}}}}
\`\`\`

Begin! Reminder to ALWAYS respond with a valid json blob of a single action. Use tools if necessary. Respond directly if appropriate. Format is Action:\`\`\`$JSON_BLOB\`\`\`then Observation:.
Question: {{query}}
Thought: {{agent_scratchpad}}
  `,
}

export const VAR_REGEX
  = /\{\{(#[a-zA-Z0-9_-]{1,50}(\.\d+)?(\.[a-zA-Z_]\w{0,29}){1,10}#)\}\}/gi

export const resetReg = () => (VAR_REGEX.lastIndex = 0)

export const DISABLE_UPLOAD_IMAGE_AS_ICON
  = process.env.NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON === 'true'

export const GITHUB_ACCESS_TOKEN
  = process.env.NEXT_PUBLIC_GITHUB_ACCESS_TOKEN || ''

export const SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS = '.difypkg,.difybndl'
export const FULL_DOC_PREVIEW_LENGTH = 50

export const JSON_SCHEMA_MAX_DEPTH = 10

export const MAX_TOOLS_NUM = getNumberConfig(
  process.env.NEXT_PUBLIC_MAX_TOOLS_NUM,
  DatasetAttr.DATA_PUBLIC_MAX_TOOLS_NUM,
  10,
)
export const MAX_PARALLEL_LIMIT = getNumberConfig(
  process.env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT,
  DatasetAttr.DATA_PUBLIC_MAX_PARALLEL_LIMIT,
  10,
)
export const TEXT_GENERATION_TIMEOUT_MS = getNumberConfig(
  process.env.NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS,
  DatasetAttr.DATA_PUBLIC_TEXT_GENERATION_TIMEOUT_MS,
  60000,
)
export const LOOP_NODE_MAX_COUNT = getNumberConfig(
  process.env.NEXT_PUBLIC_LOOP_NODE_MAX_COUNT,
  DatasetAttr.DATA_PUBLIC_LOOP_NODE_MAX_COUNT,
  100,
)
export const MAX_ITERATIONS_NUM = getNumberConfig(
  process.env.NEXT_PUBLIC_MAX_ITERATIONS_NUM,
  DatasetAttr.DATA_PUBLIC_MAX_ITERATIONS_NUM,
  99,
)
export const MAX_TREE_DEPTH = getNumberConfig(
  process.env.NEXT_PUBLIC_MAX_TREE_DEPTH,
  DatasetAttr.DATA_PUBLIC_MAX_TREE_DEPTH,
  50,
)

export const ALLOW_UNSAFE_DATA_SCHEME = getBooleanConfig(
  process.env.NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME,
  DatasetAttr.DATA_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME,
  false,
)
export const ENABLE_WEBSITE_JINAREADER = getBooleanConfig(
  process.env.NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER,
  DatasetAttr.DATA_PUBLIC_ENABLE_WEBSITE_JINAREADER,
  true,
)
export const ENABLE_WEBSITE_FIRECRAWL = getBooleanConfig(
  process.env.NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL,
  DatasetAttr.DATA_PUBLIC_ENABLE_WEBSITE_FIRECRAWL,
  true,
)
export const ENABLE_WEBSITE_WATERCRAWL = getBooleanConfig(
  process.env.NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL,
  DatasetAttr.DATA_PUBLIC_ENABLE_WEBSITE_WATERCRAWL,
  false,
)
export const ENABLE_SINGLE_DOLLAR_LATEX = getBooleanConfig(
  process.env.NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX,
  DatasetAttr.DATA_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX,
  false,
)

export const VALUE_SELECTOR_DELIMITER = '@@@'

export const validPassword = /^(?=.*[a-zA-Z])(?=.*\d)\S{8,}$/

export const ZENDESK_WIDGET_KEY = getStringConfig(
  process.env.NEXT_PUBLIC_ZENDESK_WIDGET_KEY,
  DatasetAttr.NEXT_PUBLIC_ZENDESK_WIDGET_KEY,
  '',
)
export const ZENDESK_FIELD_IDS = {
  ENVIRONMENT: getStringConfig(
    process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT,
    DatasetAttr.NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT,
    '',
  ),
  VERSION: getStringConfig(
    process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION,
    DatasetAttr.NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION,
    '',
  ),
  EMAIL: getStringConfig(
    process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL,
    DatasetAttr.NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL,
    '',
  ),
  WORKSPACE_ID: getStringConfig(
    process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID,
    DatasetAttr.NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID,
    '',
  ),
  PLAN: getStringConfig(
    process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN,
    DatasetAttr.NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN,
    '',
  ),
}
export const APP_VERSION = pkg.version

export const IS_MARKETPLACE = globalThis.document?.body?.getAttribute('data-is-marketplace') === 'true'

export const RAG_PIPELINE_PREVIEW_CHUNK_NUM = 20

export const PROVIDER_WITH_PRESET_TONE = ['langgenius/openai/openai', 'langgenius/azure_openai/azure_openai']

export const STOP_PARAMETER_RULE: ModelParameterRule = {
  default: [],
  help: {
    en_US: 'Up to four sequences where the API will stop generating further tokens. The returned text will not contain the stop sequence.',
    zh_Hans: '最多四个序列，API 将停止生成更多的 token。返回的文本将不包含停止序列。',
  },
  label: {
    en_US: 'Stop sequences',
    zh_Hans: '停止序列',
  },
  name: 'stop',
  required: false,
  type: 'tag',
  tagPlaceholder: {
    en_US: 'Enter sequence and press Tab',
    zh_Hans: '输入序列并按 Tab 键',
  },
}

export const PARTNER_STACK_CONFIG = {
  cookieName: 'partner_stack_info',
  saveCookieDays: 90,
}
