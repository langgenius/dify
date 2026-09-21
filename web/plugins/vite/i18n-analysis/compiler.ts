import path from 'node:path'
import * as ts from 'typescript'

type ModuleResolution = { id: string | null; diagnostic: boolean }
export type ModuleResolutions = ReadonlyMap<string, ReadonlyMap<string, ModuleResolution>>

// Resolve in Vite's environment before creating the synchronous TypeScript host.
// Read surviving imports from Vite's transformed code so erased type imports
// never reach the runtime resolver. Only collected source modules override TS
// resolution; packages and type-only dependencies still use TS declarations.
type ImportBinding = { specifier: string; signature: string; typeOnly: boolean; locals: string[] }

function importBindings(code: string): ImportBinding[] {
  const source = ts.createSourceFile(
    'module.tsx',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const result: ImportBinding[] = []
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause
      const bindings = clause?.namedBindings
      const names =
        bindings && ts.isNamedImports(bindings)
          ? bindings.elements
              .filter((element) => !element.isTypeOnly)
              .map(
                (element) =>
                  `${element.propertyName?.text ?? element.name.text}:${element.name.text}`,
              )
              .sort()
          : bindings && ts.isNamespaceImport(bindings)
            ? [`*:${bindings.name.text}`]
            : []
      result.push({
        specifier: statement.moduleSpecifier.text,
        signature: JSON.stringify(['import', clause?.name?.text, names]),
        locals: [
          ...(clause?.name ? [clause.name.text] : []),
          ...(bindings && ts.isNamedImports(bindings)
            ? bindings.elements
                .filter((element) => !element.isTypeOnly)
                .map((element) => element.name.text)
            : bindings
              ? [bindings.name.text]
              : []),
        ],
        typeOnly:
          !!clause?.isTypeOnly ||
          !!(
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length &&
            !names.length &&
            !clause?.name
          ),
      })
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      result.push({
        specifier: statement.moduleSpecifier.text,
        signature: JSON.stringify([
          'export',
          !statement.exportClause
            ? ['all']
            : ts.isNamespaceExport(statement.exportClause)
              ? ['namespace', statement.exportClause.name.text]
              : [
                  'named',
                  statement.exportClause.elements
                    .filter((element) => !element.isTypeOnly)
                    .map((element) =>
                      JSON.stringify([
                        (element.propertyName ?? element.name).text,
                        element.name.text,
                      ]),
                    )
                    .sort(),
                ],
        ]),
        locals: [],
        typeOnly:
          statement.isTypeOnly ||
          !!(
            statement.exportClause &&
            ts.isNamedExports(statement.exportClause) &&
            statement.exportClause.elements.length > 0 &&
            statement.exportClause.elements.every((element) => element.isTypeOnly)
          ),
      })
    }
  }
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const specifier = node.arguments[0].text
      // Dynamic imports have no stable local binding after arbitrary transforms.
      // Do not pair them by position: rewrites may reorder, split or inline calls.
      result.push({
        specifier,
        signature: JSON.stringify(['dynamic', specifier]),
        typeOnly: false,
        locals: [],
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}

export function hasClientDirective(code: string) {
  if (!code.includes('use client')) return false
  const source = ts.createSourceFile(
    'module.tsx',
    code,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  )
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break
    if (statement.expression.text === 'use client') return true
  }
  return false
}

export async function resolveTranslationImports(
  modules: ReadonlyMap<string, string>,
  compiled: ReadonlyMap<string, string>,
  resolve: (
    specifier: string,
    importer: string,
  ) => Promise<{ id: string; external?: boolean } | undefined>,
  isAsset: (specifier: string) => boolean = () => false,
) {
  const resolutions = new Map<string, Map<string, ModuleResolution>>()
  let resolveCalls = 0
  await Promise.all(
    [...modules].map(async ([id, source]) => {
      const imports = new Map<string, string | null>()
      const code = compiled.get(id) ?? ''
      const surviving = new Set(
        ts.preProcessFile(code, true, true).importedFiles.map((file) => file.fileName),
      )
      const targets = new Map<string, string | undefined>()
      const declarationImports = new Set<string>()
      const externalImports = new Set<string>()
      await Promise.all(
        [...surviving].map(async (specifier) => {
          resolveCalls++
          const resolved = await resolve(specifier, id)
          targets.set(specifier, resolved?.id)
          if (
            !/^[.#/]/.test(specifier) &&
            !specifier.startsWith('@/') &&
            (resolved?.external || resolved?.id.includes('/node_modules/'))
          )
            externalImports.add(specifier)
          const packageName = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0]!
          // A bare external package or its resolved node_modules implementation
          // may use TS declarations. Virtual/local replacements must not fall back.
          if (
            !/^[.#/]/.test(specifier) &&
            !specifier.startsWith('@/') &&
            (resolved?.id.includes(`/node_modules/${packageName}/`) ||
              (resolved?.external && resolved.id === specifier))
          )
            declarationImports.add(specifier)
        }),
      )
      for (const [specifier, target] of targets) {
        if (target && modules.has(target)) imports.set(specifier, target)
        else if (!declarationImports.has(specifier) && !isAsset(specifier))
          imports.set(specifier, null)
      }
      const before = importBindings(source)
      const after = importBindings(code)
      const proposals = new Map<string, Set<string | null | undefined>>()
      const record = (specifier: string, target: string | null | undefined) => {
        const values = proposals.get(specifier) ?? new Set<string | null | undefined>()
        values.add(target)
        proposals.set(specifier, values)
      }
      for (const binding of before) {
        if (binding.typeOnly || isAsset(binding.specifier)) continue
        const sameBinding = (candidate: ImportBinding) =>
          !candidate.typeOnly &&
          candidate.specifier === binding.specifier &&
          candidate.signature === binding.signature
        const originalCount = before.filter(sameBinding).length
        const survivingCount = after.filter(sameBinding).length
        if (originalCount === survivingCount) {
          record(binding.specifier, imports.get(binding.specifier))
          continue
        }
        // Barrel optimizers may split named imports into per-binding default
        // imports. Preserve TS declarations only if every binding still comes
        // from the same external package; local rewrites remain strict.
        const packageName = binding.specifier.startsWith('@')
          ? binding.specifier.split('/').slice(0, 2).join('/')
          : binding.specifier.split('/')[0]!
        const externalBindings =
          !/^[.#/]/.test(binding.specifier) &&
          !binding.specifier.startsWith('@/') &&
          binding.locals.length > 0 &&
          binding.locals.every((local) =>
            after.some((candidate) => {
              const target = targets.get(candidate.specifier)
              return (
                candidate.locals.includes(local) &&
                target?.includes(`/node_modules/${packageName}/`) &&
                !modules.has(target)
              )
            }),
          )
        if (externalBindings) {
          record(binding.specifier, undefined)
          continue
        }
        const candidates = after.filter(
          (candidate) => !candidate.typeOnly && candidate.signature === binding.signature,
        )
        const replacement =
          originalCount === 1 && candidates.length === 1
            ? targets.get(candidates[0]!.specifier)
            : undefined
        record(binding.specifier, replacement && modules.has(replacement) ? replacement : null)
      }
      // The TS host resolves by module specifier, not by import occurrence. If
      // bindings using one specifier diverge, block all rather than use a stale target.
      for (const [specifier, values] of proposals) {
        if (values.size > 1 || values.has(null)) imports.set(specifier, null)
        else {
          const [target] = values
          if (target !== undefined) imports.set(specifier, target)
          else imports.delete(specifier)
        }
      }
      // Resolution and diagnostics have different scopes: opaque dependencies
      // still block stale disk fallback, but only source imports need warnings.
      const sourceImports = new Set(
        before.filter((binding) => !binding.typeOnly).map((binding) => binding.specifier),
      )
      resolutions.set(
        id,
        new Map(
          [...imports].map(([specifier, target]) => [
            specifier,
            {
              id: target,
              diagnostic:
                target === null &&
                sourceImports.has(specifier) &&
                !externalImports.has(specifier) &&
                !specifier.includes('/node_modules/') &&
                specifier !== 'server-only' &&
                specifier !== 'client-only' &&
                !/\.(?:css|scss|sass|less|styl)(?:\?|$)/.test(specifier) &&
                !isAsset(specifier.split('?')[0]!),
            },
          ]),
        ),
      )
    }),
  )
  return { resolutions, resolveCalls }
}

export function readCompilerOptions(root: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists)
  const config = configPath ? ts.readConfigFile(configPath, ts.sys.readFile) : undefined
  if (config?.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const options =
    configPath && config
      ? ts.parseJsonConfigFileContent(
          config.config,
          { ...ts.sys, readDirectory: () => [] },
          path.dirname(configPath),
        ).options
      : {}
  return {
    ...options,
    allowJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
    skipLibCheck: true,
  }
}

export function createTranslationProgram(
  root: string,
  modules: ReadonlyMap<string, string>,
  resolutions: ModuleResolutions,
  compilerOptions = readCompilerOptions(root),
) {
  // TypeScript needs recognizable extensions. Give query variants distinct,
  // in-memory filenames in the same directory, retaining their Vite identities.
  const fileNames = new Map<string, string>()
  const moduleIds = new Map<string, string>()
  const sources = new Map<string, string>()
  for (const [id, source] of modules) {
    const file = id.split('?')[0]!
    let fileName = id.endsWith('.json') ? `${id}.__dify_i18n.ts` : id
    if (id !== file) {
      fileName = `${file}.__dify_i18n_${fileNames.size}${path.extname(file)}`
      while (modules.has(fileName) || moduleIds.has(fileName))
        fileName = `${fileName}${path.extname(file)}`
    }
    fileNames.set(id, fileName)
    moduleIds.set(fileName, id)
    sources.set(fileName, source)
  }
  const host = ts.createCompilerHost(compilerOptions)
  const readFile = host.readFile.bind(host)
  host.readFile = (file) => sources.get(file) ?? readFile(file)
  const fileExists = host.fileExists.bind(host)
  host.fileExists = (file) => sources.has(file) || fileExists(file)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(file)
    return source === undefined
      ? getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(file, source, languageVersion, true)
  }
  const cache = ts.createModuleResolutionCache(root, host.getCanonicalFileName, compilerOptions)
  host.resolveModuleNameLiterals = (
    literals,
    containingFile,
    redirectedReference,
    options,
    containingSourceFile,
  ) =>
    literals.map((literal) => {
      const importer = moduleIds.get(containingFile)
      const resolvedId = importer && resolutions.get(importer)?.get(literal.text)?.id
      if (resolvedId === null) return { resolvedModule: undefined }
      const resolvedFileName = resolvedId && fileNames.get(resolvedId)
      if (resolvedFileName) {
        const extension = Object.values(ts.Extension).find((extension) =>
          resolvedFileName.endsWith(extension),
        )
        return { resolvedModule: { resolvedFileName, extension: extension ?? ts.Extension.Ts } }
      }
      return ts.resolveModuleName(
        literal.text,
        containingFile,
        options,
        host,
        cache,
        redirectedReference,
        ts.getModeForUsageLocation(containingSourceFile, literal, options),
      )
    })
  const roots = [...fileNames].filter(([id]) => !id.endsWith('.json')).map(([, file]) => file)
  const program = ts.createProgram(roots, compilerOptions, host)
  return { program, fileNames }
}
