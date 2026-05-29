import { BaseError } from "../errors/base";
import { ErrorCode } from "../errors/codes";
import { OutputFormat } from "./output";
import type { FlagDefinition } from "./types";

export class OutputFormatNotSupportedError extends BaseError {
  constructor(format: string, supported?: string[]) {
    if (!supported) {
        supported = Object.values(OutputFormat)
    }
    super({
      code: ErrorCode.IllegalArgumentError,
      message: `format ${format} is not supported by this command`,
      hint: supported ? `supported: ${supported}` : ''
    })
  }
}

export class UnspoortedArgValueError extends BaseError {
  constructor(flagName: string, flagDef: FlagDefinition, givenValue: string) {
    super({
      code: ErrorCode.IllegalArgumentError,
      message: `illgal value: ${givenValue} --${flagName} / -${flagDef.char} has unsupported value ${givenValue}`,
      hint: `supported value: ${flagDef.options}`
    })
  }
}