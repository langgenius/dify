import type { Printer, PrintFlags } from './printer.js'
import { isModer, NoCompatiblePrinterError, payload } from './printer.js'

const ALLOWED = ['name'] as const

export type NameHandler = {
  id: (raw: unknown) => string
}

export class NamePrintFlags implements PrintFlags {
  operation = ''
  private readonly handlers = new Map<string, NameHandler>()

  register(handler: NameHandler, ...keys: string[]): void {
    for (const k of keys) this.handlers.set(k, handler)
  }

  allowedFormats(): readonly string[] {
    return ALLOWED
  }

  toPrinter(format: string): Printer {
    if (format !== 'name')
      throw new NoCompatiblePrinterError(format, ALLOWED)
    const handlers = this.handlers
    const operation = this.operation
    return {
      print(obj) {
        if (!isModer(obj))
          throw new Error(`name printer: payload does not implement Moder`)
        const mode = obj.mode()
        const h = handlers.get(mode)
        if (h === undefined) {
          const known = [...handlers.keys()].sort().join(', ')
          throw new Error(`name printer: no handler for mode "${mode}" (registered: ${known})`)
        }
        const id = h.id(payload(obj))
        return operation === '' ? `${id}\n` : `${id} ${operation}\n`
      },
    }
  }
}
