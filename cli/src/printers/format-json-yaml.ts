import type { Printer, PrintFlags } from './printer.js'
import yaml from 'js-yaml'
import { NoCompatiblePrinterError, payload } from './printer.js'

const ALLOWED = ['json', 'yaml'] as const

const jsonPrinter: Printer = {
  print(obj) {
    return `${JSON.stringify(payload(obj), null, 2)}\n`
  },
}

const yamlPrinter: Printer = {
  print(obj) {
    return yaml.dump(payload(obj), { indent: 2, lineWidth: -1 })
  },
}

export class JsonYamlPrintFlags implements PrintFlags {
  allowedFormats(): readonly string[] {
    return ALLOWED
  }

  toPrinter(format: string): Printer {
    switch (format) {
      case 'json': return jsonPrinter
      case 'yaml': return yamlPrinter
      default: throw new NoCompatiblePrinterError(format, ALLOWED)
    }
  }
}
