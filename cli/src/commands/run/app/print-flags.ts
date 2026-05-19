import type { PrintFlags } from '../../../printers/printer.js'
import type { StreamPrinter } from '../../../printers/stream-printer.js'
import { JsonYamlPrintFlags } from '../../../printers/format-json-yaml.js'
import { TextPrintFlags } from '../../../printers/format-text.js'
import { CompositePrintFlags } from '../../../printers/printer.js'
import { chatTextHandler, completionTextHandler, RUN_MODES, workflowTextHandler } from './handlers.js'
import { streamPrinterFor } from './stream-handlers.js'

export class AppRunPrintFlags extends CompositePrintFlags {
  private readonly jsonYaml = new JsonYamlPrintFlags()
  private readonly text = new TextPrintFlags()

  constructor() {
    super()
    this.text.register(chatTextHandler, RUN_MODES.Chat, RUN_MODES.AgentChat, RUN_MODES.AdvancedChat)
    this.text.register(completionTextHandler, RUN_MODES.Completion)
    this.text.register(workflowTextHandler, RUN_MODES.Workflow)
  }

  protected families(): readonly PrintFlags[] {
    return [this.jsonYaml, this.text]
  }

  toStreamPrinter(mode: string, think = false, isTTY = false): StreamPrinter {
    return streamPrinterFor(mode, think, isTTY)
  }
}
