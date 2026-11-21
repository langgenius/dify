const vscode = require('vscode')
const { backendLocations } = require('./locations.cjs')

function activate(context) {
  const selector = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].map(
    (language) => ({ language, scheme: 'file' }),
  )
  const provider = {
    async provideDefinition(document, position, token) {
      // Ask TS for the resolved symbol's documentation. This also handles aliases,
      // re-exports, custom client paths and query clients without parsing source text.
      const hovers = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        document.uri,
        position,
      )
      if (token.isCancellationRequested) return []
      const origins = backendLocations((hovers ?? []).flatMap((hover) => hover.contents))
      const definitions = []
      for (const origin of origins) {
        const uri = vscode.Uri.parse(origin.uri)
        try {
          const stat = await vscode.workspace.fs.stat(uri)
          if (token.isCancellationRequested) return []
          if (stat.type & vscode.FileType.File)
            definitions.push(new vscode.Location(uri, new vscode.Position(origin.line - 1, 0)))
        } catch {
          // Imported contracts can refer to backend checkouts absent on this machine.
        }
      }
      return definitions
    },
  }
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, provider))
  context.subscriptions.push(
    vscode.languages.registerImplementationProvider(selector, {
      provideImplementation: provider.provideDefinition,
    }),
  )
}

module.exports = { activate }
