export type Format = '' | 'wide' | 'json' | 'yaml' | 'name'

export type Printer = {
  print: (obj: unknown) => string
}

export type RawObject = {
  raw: () => unknown
}

export type Moder = {
  mode: () => string
}

export type PrintFlags = {
  allowedFormats: () => readonly string[]
  toPrinter: (format: string) => Printer
}

export class NoCompatiblePrinterError extends Error {
  override readonly name = 'NoCompatiblePrinterError'
  readonly format: string
  readonly allowed: readonly string[]

  constructor(format: string, allowed: readonly string[]) {
    super(
      allowed.length === 0
        ? `output format ${JSON.stringify(format)} not supported`
        : `output format ${JSON.stringify(format)} not supported, allowed: ${allowed.join(', ')}`,
    )
    this.format = format
    this.allowed = allowed
  }
}

export function isNoCompatiblePrinter(err: unknown): err is NoCompatiblePrinterError {
  return err instanceof NoCompatiblePrinterError
}

export abstract class CompositePrintFlags implements PrintFlags {
  protected abstract families(): readonly PrintFlags[]

  allowedFormats(): readonly string[] {
    const seen = new Set<string>()
    for (const fam of this.families()) {
      for (const f of fam.allowedFormats()) {
        if (f !== '')
          seen.add(f)
      }
    }
    return [...seen].sort()
  }

  toPrinter(format: string): Printer {
    for (const fam of this.families()) {
      try {
        return fam.toPrinter(format)
      }
      catch (err) {
        if (!isNoCompatiblePrinter(err))
          throw err
      }
    }
    throw new NoCompatiblePrinterError(format, this.allowedFormats())
  }
}

export function isRawObject(v: unknown): v is RawObject {
  return typeof v === 'object'
    && v !== null
    && typeof (v as { raw?: unknown }).raw === 'function'
}

export function isModer(v: unknown): v is Moder {
  return typeof v === 'object'
    && v !== null
    && typeof (v as { mode?: unknown }).mode === 'function'
}

export function payload(obj: unknown): unknown {
  return isRawObject(obj) ? obj.raw() : obj
}
