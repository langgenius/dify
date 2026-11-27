import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as consoleErrorMaps from '@dify/contracts/api/console/errors.gen'
import * as webErrorMaps from '@dify/contracts/api/web/errors.gen'
import { describe, expect, it } from 'vite-plus/test'
import requestErrors from '@/i18n/locales/en-US/request-errors.json'
import {
  catalogedRequestErrorCodes,
  forbiddenMessages,
  passthroughRequestErrorCodes,
  planLimitMessages,
  requestErrorTemplates,
} from '../request-error-codes'

/**
 * Framework codes that only name the HTTP status, such as Werkzeug's `not_found` (`forbidden` is
 * cataloged instead). Their server message names what failed in English, so the caller's
 * translated fallback comes first and the server message replaces only generic text.
 */
const genericRequestErrorCodes = [
  'bad_request',
  'conflict',
  'internal_server_error',
  'method_not_allowed',
  'not_found',
  'request_entity_too_large',
  'too_many_requests',
  'unauthorized',
  'unknown',
  'unprocessable_entity',
] as const

// The backend sentence behind each template, as its source writes it.
const templateSources: Record<keyof typeof requestErrorTemplates, [file: string, text: string]> = {
  dataset_name_duplicate: [
    'api/services/knowledge/dataset_service.py',
    'f"Dataset with name {name} already exists."',
  ],
  email_change_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many email change emails have been sent. Please try again in {minutes} minutes."',
  ],
  email_code_account_deletion_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many account deletion emails have been sent. Please try again in {minutes} minutes."',
  ],
  email_code_login_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many login emails have been sent. Please try again in {minutes} minutes."',
  ],
  email_register_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many email register emails have been sent. Please try again in {minutes} minutes."',
  ],
  file_extension_blocked: [
    'api/services/file_service.py',
    'f"File extension \'.{extension}\' is not allowed for security reasons"',
  ],
  invalid_metadata: [
    'api/controllers/console/datasets/datasets_document.py',
    'f"Invalid metadata value: {metadata}"',
  ],
  network_access_unsupported_access_points: [
    'api/controllers/console/workspace/network_access_group.py',
    'f"Unsupported access points for this app: {\', \'.join(exc.access_points)}."',
  ],
  network_access_unsupported_app_mode: [
    'api/controllers/console/workspace/network_access_group.py',
    'f"Network access control is not supported for app mode \'{exc.app_mode}\'."',
  ],
  owner_transfer_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many owner transfer emails have been sent. Please try again in {minutes} minutes."',
  ],
  password_reset_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many password reset emails have been sent. Please try again in {minutes} minutes."',
  ],
}

const documentedCodes = [
  ...new Set(
    [consoleErrorMaps, webErrorMaps].flatMap((errorMaps) =>
      Object.values(errorMaps).flatMap((errorMap) => Object.keys(errorMap)),
    ),
  ),
].sort()

const catalogKeys = Object.keys(requestErrors)
  .filter((key) => key.startsWith('code.'))
  .map((key) => key.slice('code.'.length))
  .sort()

describe('request error codes', () => {
  it('lists exactly the codes the English catalog translates', () => {
    expect([...catalogedRequestErrorCodes].sort()).toEqual(catalogKeys)
  })

  it('gives every code one treatment', () => {
    const codes = [
      ...catalogedRequestErrorCodes,
      ...passthroughRequestErrorCodes,
      ...genericRequestErrorCodes,
    ]
    expect(codes.filter((code, index) => codes.indexOf(code) !== index)).toEqual([])
  })

  it('gives every code the console and web app contracts document a treatment', () => {
    const handled = new Set<string>([
      ...catalogedRequestErrorCodes,
      ...passthroughRequestErrorCodes,
      ...genericRequestErrorCodes,
    ])
    expect(documentedCodes.filter((code) => !handled.has(code))).toEqual([])
  })

  it('translates every plan-limit text the console checks answer with', () => {
    const wraps = readFileSync(
      path.resolve(process.cwd(), '../api/controllers/console/wraps.py'),
      'utf8',
    )
    const backendMessages = [...wraps.matchAll(/abort\(\s*403,\s*"([^"]+)"/g)].map(
      (match) => match[1],
    )

    expect(Object.keys(planLimitMessages).sort()).toEqual([...new Set(backendMessages)].sort())
    expect(Object.values(planLimitMessages).sort()).toEqual(
      Object.keys(requestErrors)
        .filter((key) => key.startsWith('planLimit.'))
        .map((key) => key.slice('planLimit.'.length))
        .sort(),
    )
  })

  it('matches every templated sentence the backend writes and translates it', () => {
    for (const [code, [file, text]] of Object.entries(templateSources)) {
      const source = readFileSync(path.resolve(process.cwd(), '..', file), 'utf8')
      expect(source, `${file} no longer writes ${text}`).toContain(text)
      const sample = text
        .replace(/^f?"|"$/g, '')
        .replace(/\{minutes\}/g, '5')
        .replace(/\{[^}]+\}/g, 'sample')
      expect(requestErrorTemplates[code as keyof typeof requestErrorTemplates].test(sample)).toBe(
        true,
      )
    }
    expect(
      Object.keys(requestErrors)
        .filter((key) => key.startsWith('template.'))
        .map((key) => key.slice('template.'.length))
        .sort(),
    ).toEqual(Object.keys(requestErrorTemplates).sort())
  })

  it('translates every fixed forbidden reason the console and web app backends raise', () => {
    const roots = [
      'api/controllers/console',
      'api/controllers/web',
      'api/controllers/files',
      'api/libs',
      'api/services',
      'api/core',
    ]
    const sources = roots.flatMap((root) => {
      const dir = path.resolve(process.cwd(), '..', root)
      return (readdirSync(dir, { recursive: true }) as string[])
        .filter((file) => file.endsWith('.py') && !file.includes('tests'))
        .map((file) => readFileSync(path.join(dir, file), 'utf8'))
    })
    sources.push(readFileSync(path.resolve(process.cwd(), '../api/app_factory.py'), 'utf8'))
    const raised = new Set<string>()
    const forbidden =
      /(?:\bForbidden\(\s*(?:description=)?|\babort\(\s*403,\s*)(?:"([^"]+)"|'([^']+)')/g
    for (const source of sources)
      for (const match of source.matchAll(forbidden)) raised.add((match[1] ?? match[2])!)

    const known = new Set<string>([
      ...Object.keys(planLimitMessages),
      ...Object.keys(forbiddenMessages),
    ])
    expect([...raised].filter((message) => !known.has(message)).sort()).toEqual([])
    expect(Object.values(forbiddenMessages).sort()).toEqual(
      Object.keys(requestErrors)
        .filter((key) => key.startsWith('forbidden.'))
        .map((key) => key.slice('forbidden.'.length))
        .sort(),
    )
  })
})
