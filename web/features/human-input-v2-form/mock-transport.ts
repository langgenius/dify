import type { HumanInputV2FormTransport, HumanInputV2UploadedFile } from './types'
import type { HumanInputFormDefinition } from '@/features/human-input-form/types'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { createHumanInputV2Error } from './errors'

export const HUMAN_INPUT_V2_MOCK_OTP = '246810'

export type HumanInputV2MockScenario = {
  definition: HumanInputFormDefinition
  formState?: 'valid' | 'not-found' | 'expired' | 'submitted' | 'rate-limited'
  accessState?: 'valid' | 'delivery-failed' | 'rate-limited'
  resendFailure?: boolean
  submitState?: 'valid' | 'concurrent-completion'
  uploadState?: 'valid' | 'failed'
  otp: string
  resendAfterSeconds: number
  expiresInSeconds: number
}

type MockTransportOptions = {
  scenario?: Partial<HumanInputV2MockScenario>
  now?: () => number
}

const createDefaultDefinition = (now: () => number): HumanInputFormDefinition => ({
  formContent: 'Please review the request.\n\n{{#$output.response#}}\n\n{{#$output.attachments#}}',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'response',
      default: {
        type: 'constant',
        value: 'Looks good',
        selector: [],
      },
    },
    {
      type: InputVarType.multiFiles,
      output_variable_name: 'attachments',
      allowed_file_extensions: [],
      allowed_file_types: [SupportUploadFileTypes.document],
      allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      number_limits: 3,
    },
  ],
  resolvedDefaultValues: { response: 'Looks good' },
  actions: [
    {
      id: 'approve',
      title: 'Approve',
      button_style: UserActionButtonType.Primary,
    },
    {
      id: 'reject',
      title: 'Reject',
      button_style: UserActionButtonType.Default,
    },
  ],
  expirationTime: Math.floor(now() / 1000) + 24 * 60 * 60,
})

export const createHumanInputV2MockScenario = (
  overrides: Partial<HumanInputV2MockScenario> = {},
  now: () => number = Date.now,
): HumanInputV2MockScenario => ({
  definition: createDefaultDefinition(now),
  formState: 'valid',
  accessState: 'valid',
  resendFailure: false,
  submitState: 'valid',
  uploadState: 'valid',
  otp: HUMAN_INPUT_V2_MOCK_OTP,
  resendAfterSeconds: 30,
  expiresInSeconds: 300,
  ...overrides,
})

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

export const createMockHumanInputV2FormTransport = ({
  scenario: scenarioOverrides,
  now = Date.now,
}: MockTransportOptions = {}): HumanInputV2FormTransport => {
  const scenario = createHumanInputV2MockScenario(scenarioOverrides, now)
  let challengeSequence = 0
  let uploadSequence = 0
  const sessions = new Map<
    string,
    {
      currentChallenge?: { token: string; issuedAt: number; expiresAt: number }
      submitted: boolean
      submitting: boolean
    }
  >()

  const getSession = (token: string) => {
    let session = sessions.get(token)
    if (!session) {
      session = {
        submitted: scenario.formState === 'submitted',
        submitting: false,
      }
      sessions.set(token, session)
    }
    return session
  }

  const getForm: HumanInputV2FormTransport['getForm'] = async (token, options) => {
    throwIfAborted(options?.signal)
    const session = getSession(token)
    if (scenario.formState === 'not-found')
      throw createHumanInputV2Error('not-found', 'human_input_form_not_found', 404)
    if (scenario.formState === 'expired')
      throw createHumanInputV2Error('form-expired', 'human_input_form_expired', 410)
    if (session.submitted)
      throw createHumanInputV2Error('already-submitted', 'human_input_form_submitted', 409)
    if (scenario.formState === 'rate-limited')
      throw createHumanInputV2Error('form-rate-limit', 'web_form_rate_limit_exceeded', 429)

    return structuredClone(scenario.definition)
  }

  const requestAccess: HumanInputV2FormTransport['requestAccess'] = async (token, options) => {
    throwIfAborted(options?.signal)
    const session = getSession(token)
    if (scenario.accessState === 'delivery-failed')
      throw createHumanInputV2Error('access-delivery-failed', 'human_input_access_delivery_failed')
    if (scenario.accessState === 'rate-limited')
      throw createHumanInputV2Error(
        'access-rate-limit',
        'human_input_access_rate_limit_exceeded',
        429,
      )

    const receiptTime = now()
    if (
      session.currentChallenge &&
      receiptTime < session.currentChallenge.issuedAt + scenario.resendAfterSeconds * 1000
    )
      throw createHumanInputV2Error(
        'access-rate-limit',
        'human_input_access_rate_limit_exceeded',
        429,
      )
    if (session.currentChallenge && scenario.resendFailure)
      throw createHumanInputV2Error('network', 'human_input_access_network_error')

    challengeSequence += 1
    session.currentChallenge = {
      token: `mock-challenge-${challengeSequence}`,
      issuedAt: receiptTime,
      expiresAt: receiptTime + scenario.expiresInSeconds * 1000,
    }

    return {
      challengeToken: session.currentChallenge.token,
      resendAfterSeconds: scenario.resendAfterSeconds,
      expiresInSeconds: scenario.expiresInSeconds,
    }
  }

  const submit: HumanInputV2FormTransport['submit'] = async (token, payload, options) => {
    throwIfAborted(options?.signal)
    const session = getSession(token)
    if (session.submitting || scenario.submitState === 'concurrent-completion' || session.submitted)
      throw createHumanInputV2Error('already-submitted', 'human_input_form_submitted', 409)

    session.submitting = true
    try {
      if (!session.currentChallenge || payload.challenge_token !== session.currentChallenge.token)
        throw createHumanInputV2Error('challenge-stale', 'human_input_challenge_stale', 409)
      if (now() >= session.currentChallenge.expiresAt)
        throw createHumanInputV2Error('challenge-expired', 'human_input_challenge_expired', 410)
      if (payload.otp_code !== scenario.otp)
        throw createHumanInputV2Error('invalid-otp', 'human_input_invalid_otp', 400)
      if (!scenario.definition.actions.some((action) => action.id === payload.action))
        throw createHumanInputV2Error('unknown', 'human_input_action_invalid', 400)

      session.submitted = true
      session.currentChallenge = undefined
    } finally {
      session.submitting = false
    }
  }

  const makeUploadedFile = (name: string, mimeType: string, size: number, url: string) => {
    uploadSequence += 1
    return {
      id: `mock-upload-${uploadSequence}`,
      name,
      mimeType,
      size,
      url,
    } satisfies HumanInputV2UploadedFile
  }

  return {
    getForm,
    requestAccess,
    submit,
    requestUploadToken: async (_token, options) => {
      throwIfAborted(options?.signal)
      if (scenario.uploadState === 'failed')
        throw createHumanInputV2Error('upload-failed', 'human_input_upload_failed')
      uploadSequence += 1
      return {
        uploadToken: `mock-upload-token-${uploadSequence}`,
        expiresAt: Math.floor(now() / 1000) + 300,
      }
    },
    uploadLocalFile: async (_token, file, options) => {
      throwIfAborted(options?.signal)
      if (scenario.uploadState === 'failed')
        throw createHumanInputV2Error('upload-failed', 'human_input_upload_failed')
      return makeUploadedFile(file.name, file.type, file.size, '')
    },
    uploadRemoteFile: async (_token, url, options) => {
      throwIfAborted(options?.signal)
      if (scenario.uploadState === 'failed')
        throw createHumanInputV2Error('upload-failed', 'human_input_upload_failed')
      return makeUploadedFile(url, 'application/octet-stream', 0, url)
    },
  }
}
