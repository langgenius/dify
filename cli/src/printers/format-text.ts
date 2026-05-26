import type { Printer, PrintFlags } from './printer.js'
import { isModer, NoCompatiblePrinterError, payload } from './printer.js'

const ALLOWED = ['', 'text'] as const

export type TextHandler = {
  render: (raw: unknown) => string
}

export class TextPrintFlags implements PrintFlags {
  private readonly handlers = new Map<string, TextHandler>()

  register(handler: TextHandler, ...keys: string[]): void {
    for (const k of keys) this.handlers.set(k, handler)
  }

  allowedFormats(): readonly string[] {
    return ALLOWED
  }

  toPrinter(format: string): Printer {
    if (format !== '' && format !== 'text')
      throw new NoCompatiblePrinterError(format, ALLOWED)
    const handlers = this.handlers
    return {
      print(obj) {
        if (!isModer(obj))
          throw new Error('text printer: payload does not implement Moder')
        const mode = obj.mode()
        const h = handlers.get(mode)
        if (h === undefined) {
          const known = [...handlers.keys()].sort().join(', ')
          throw new Error(`text printer: no handler for mode "${mode}" (registered: ${known})`)
        }
        return h.render(payload(obj))
      },
    }
  }
}
