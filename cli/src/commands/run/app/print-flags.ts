import type { PrintFlags } from '@/printers/printer'
import type { StreamPrinter } from '@/printers/stream-printer'
import { JsonYamlPrintFlags } from '@/printers/format-json-yaml'
import { TextPrintFlags } from '@/printers/format-text'
import { CompositePrintFlags } from '@/printers/printer'
import { chatTextHandler, completionTextHandler, RUN_MODES, workflowTextHandler } from './handlers'
import { streamPrinterFor } from './stream-handlers'

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
