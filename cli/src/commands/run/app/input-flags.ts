import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

// Output formats that render the run/resume result as plain text rather than JSON/YAML.
export const TEXT_FORMATS = new Set(['', 'text'])

// Shared by `run app` and `resume app`: --inputs (inline JSON) / --inputs-file (JSON file) /
// direct inputs are mutually exclusive ways to supply the run's variable map.
export async function resolveInputs(
  inputsJson: string | undefined,
  inputsFile: string | undefined,
  directInputs: Readonly<Record<string, unknown>> | undefined,
): Promise<Record<string, unknown>> {
  if (inputsJson !== undefined && inputsFile !== undefined)
    throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--inputs and --inputs-file are mutually exclusive' })
  if (inputsJson !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(inputsJson)
    }
    catch {
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--inputs must be valid JSON' })
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--inputs must be a JSON object' })
    return parsed as Record<string, unknown>
  }
  if (inputsFile !== undefined) {
    const { readFile } = await import('node:fs/promises')
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(inputsFile, 'utf8'))
    }
    catch {
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--inputs-file must contain valid JSON' })
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--inputs-file must be a JSON object' })
    return parsed as Record<string, unknown>
  }
  return { ...(directInputs ?? {}) }
}
