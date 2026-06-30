import type { FlagDefinition } from './types'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

export class OutputFormatNotSupportedError extends BaseError {
  constructor(format: string) {
    super({
      code: ErrorCode.IllegalArgumentError,
      message: `format ${format} is not supported by this command`,
    })
  }
}

export class UnsupportedArgValueError extends BaseError {
  constructor(flagName: string, flagDef: FlagDefinition, givenValue: string) {
    const flagLabel = flagDef.char ? `--${flagName} / -${flagDef.char}` : `--${flagName}`
    super({
      code: ErrorCode.IllegalArgumentError,
      message: `illegal value ${givenValue} for flag ${flagLabel}`,
      hint: flagDef.options ? `supported value: ${flagDef.options.join(', ')}` : '',
    })
  }
}
