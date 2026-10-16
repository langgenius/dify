import type { Reporter, Rule } from '@tsslint/config'
import ts from 'typescript'

const fileName = '/virtual/test.ts'
const options: ts.CompilerOptions = { strict: true, noEmit: true }

function createProgram(code: string) {
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name === fileName
      ? ts.createSourceFile(name, code, languageVersion, true)
      : getSourceFile(name, languageVersion, ...rest)
  const program = ts.createProgram([fileName], options, host)
  return { program, file: program.getSourceFile(fileName)! }
}

/** Counts the type errors of a single strict-mode file. */
export function countTypeErrors(code: string) {
  const { program, file } = createProgram(code)
  return program.getSyntacticDiagnostics(file).length + program.getSemanticDiagnostics(file).length
}

/** Runs a tsslint rule on a single strict-mode file and returns each report with its fix applied. */
export function lintWithRule(rule: Rule, code: string) {
  const { program, file } = createProgram(code)

  const results: { message: string; fixed: string }[] = []
  rule({
    typescript: ts,
    program,
    file,
    report(message) {
      const reporter: Reporter = {
        at: () => reporter,
        asWarning: () => reporter,
        asError: () => reporter,
        asSuggestion: () => reporter,
        withDeprecated: () => reporter,
        withUnnecessary: () => reporter,
        withRefactor: () => reporter,
        withoutCache: () => reporter,
        withFix(_title, getChanges) {
          const { span, newText } = getChanges()[0]!.textChanges[0]!
          results.push({
            message,
            fixed: code.slice(0, span.start) + newText + code.slice(span.start + span.length),
          })
          return reporter
        },
      }
      return reporter
    },
  })
  return results
}
