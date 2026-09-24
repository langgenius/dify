import type { InputVar } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'
import { basePath } from '@/utils/var'

export type WorkflowLaunchInputValue = string | boolean
export type EmbeddedWebAppRoute = 'chatbot' | 'agent'
export type WorkflowHiddenStartVariable = Pick<
  InputVar,
  'default' | 'hide' | 'label' | 'max_length' | 'options' | 'required' | 'type' | 'variable'
>

const SUPPORTED_WORKFLOW_LAUNCH_INPUT_TYPES = new Set<InputVarType>([
  InputVarType.textInput,
  InputVarType.paragraph,
  InputVarType.select,
  InputVarType.number,
  InputVarType.checkbox,
  InputVarType.json,
  InputVarType.jsonObject,
  InputVarType.url,
])

const coerceWorkflowLaunchDefaultValue = (
  variable: WorkflowHiddenStartVariable,
): WorkflowLaunchInputValue => {
  if (variable.type === InputVarType.checkbox) {
    if (typeof variable.default === 'boolean') return variable.default

    return String(variable.default).toLowerCase() === 'true'
  }

  if (typeof variable.default === 'number') return String(variable.default)

  return String(variable.default ?? '')
}

export const isWorkflowLaunchInputSupported = (variable: WorkflowHiddenStartVariable) => {
  return SUPPORTED_WORKFLOW_LAUNCH_INPUT_TYPES.has(variable.type)
}

export const createWorkflowLaunchInitialValues = (variables: WorkflowHiddenStartVariable[]) => {
  return variables.reduce<Record<string, WorkflowLaunchInputValue>>((acc, variable) => {
    acc[variable.variable] = coerceWorkflowLaunchDefaultValue(variable)
    return acc
  }, {})
}

export const buildWorkflowLaunchUrl = async ({
  accessibleUrl,
  variables,
  values,
}: {
  accessibleUrl: string
  variables: WorkflowHiddenStartVariable[]
  values: Record<string, WorkflowLaunchInputValue>
}) => {
  const targetUrl = new URL(accessibleUrl, window.location.origin)
  variables.forEach((variable) => {
    const rawValue = values[variable.variable]
    const serializedValue =
      variable.type === InputVarType.checkbox ? String(Boolean(rawValue)) : String(rawValue ?? '')

    targetUrl.searchParams.set(variable.variable, serializedValue)
  })

  return targetUrl.toString()
}

export const getEmbeddedIframeSnippet = (iframeUrl: string) =>
  `<iframe
 src="${iframeUrl}"
 style="width: 100%; height: 100%; min-height: 700px"
 frameborder="0"
 allow="microphone;clipboard-write">
</iframe>`

const getScriptInputsContent = (values: Record<string, WorkflowLaunchInputValue>) => {
  const entries = Object.entries(values)

  if (!entries.length) {
    return `{
    // You can define the inputs from the Start node here
    // key is the variable name
    // e.g.
    // name: "NAME"
  }`
  }

  return `{
${entries.map(([key, value]) => `    ${key}: ${JSON.stringify(value)},`).join('\n')}
  }`
}

export const getEmbeddedScriptSnippet = ({
  url,
  token,
  webAppRoute = 'chatbot',
  primaryColor,
  isTestEnv,
  inputValues,
}: {
  url: string
  token: string
  webAppRoute?: EmbeddedWebAppRoute
  primaryColor: string
  isTestEnv?: boolean
  inputValues: Record<string, WorkflowLaunchInputValue>
}) => {
  return `<script>
 window.difyChatbotConfig = {
  token: '${token}'${
    isTestEnv
      ? `,
  isDev: true`
      : ''
  },
  baseUrl: '${url}${basePath}'${
    webAppRoute !== 'chatbot'
      ? `,
  routeSegment: '${webAppRoute}'`
      : ''
  },
  inputs: ${getScriptInputsContent(inputValues)},
  systemVariables: {
    // user_id: 'YOU CAN DEFINE USER ID HERE',
    // conversation_id: 'YOU CAN DEFINE CONVERSATION ID HERE, IT MUST BE A VALID UUID',
  },
  userVariables: {
    // avatar_url: 'YOU CAN DEFINE USER AVATAR URL HERE',
    // name: 'YOU CAN DEFINE USER NAME HERE',
  },
 }
</script>
<script
 src="${url}${basePath}/embed.min.js"
 id="${token}"
 defer>
</script>
<style>
  #dify-chatbot-bubble-button {
    background-color: ${primaryColor} !important;
  }
  #dify-chatbot-bubble-window {
    width: 24rem !important;
    height: 40rem !important;
  }
</style>`
}

export const getChromePluginContent = (iframeUrl: string) => `ChatBot URL: ${iframeUrl}`

export const compressAndEncodeBase64 = async (input: string) => {
  const uint8Array = new TextEncoder().encode(input)
  if (typeof CompressionStream === 'undefined') return btoa(String.fromCharCode(...uint8Array))

  const compressedStream = new Response(
    new Blob([uint8Array]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer()
  const compressedUint8Array = new Uint8Array(await compressedStream)
  return btoa(String.fromCharCode(...compressedUint8Array))
}
