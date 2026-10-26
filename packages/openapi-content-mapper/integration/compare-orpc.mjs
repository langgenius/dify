/* oxlint-disable antfu/no-import-dist -- Audit the built native mapper against generated repository contracts. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConsoleDocument } from '../../contracts/scripts/compose-console-openapi.mjs'
import { describeOperations } from '../dist/operation.js'
import { createRouter } from '../dist/tooling/router.js'
/* oxlint-enable antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
const repo = resolve(root, '../..')
const specDir = process.env.DIFY_OPENAPI_DIR ?? resolve(root, '../contracts/openapi')
const enforceAlignment = process.argv.includes('--check')
const consoleOnly = process.argv.includes('--console')
const updateBaseline = process.argv.includes('--update-baseline')
const output = resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')) ??
    join(root, 'reports/orpc-comparison.json'),
)
const documents = consoleOnly
  ? ['console-client']
  : ['console', 'fastopenapi-console', 'service', 'openapi', 'web', 'inner', 'knowledge-fs']
const report = {
  scope:
    'All repository OpenAPI operations versus existing generated/api oRPC procedures; static schema input/output types, not validation, errors or transport execution.',
  documents: [],
  matched: [],
  unmatchedOpenApi: [],
  unmatchedOrpc: [],
  compilerErrors: [],
}
const key = (surface, method, path) => `${surface} ${method.toUpperCase()} ${path}`
report.sourceRevision = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repo,
  encoding: 'utf8',
}).stdout.trim()
report.compilerVersion = spawnSync(
  process.execPath,
  [join(root, 'node_modules/typescript/bin/tsc'), '--version'],
  { encoding: 'utf8' },
).stdout.trim()
report.generatedFiles = [...globSync(join(repo, 'packages/contracts/generated/api/**/*.ts'))]
  .sort()
  .map((file) => ({
    file: relative(repo, file),
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  }))
report.sdkTypeSourceSha256 = createHash('sha256')
  .update(readFileSync(join(root, 'src/types.ts')))
  .digest('hex')
const contracts = new Map()
const contractFiles = consoleOnly
  ? [
      ...globSync(join(repo, 'packages/contracts/generated/api/console/**/orpc.gen.ts')),
      join(repo, 'packages/contracts/generated/enterprise/orpc.gen.ts'),
      join(repo, 'packages/contracts/generated/enterprise-app-deploy/orpc.gen.ts'),
    ]
  : [...globSync(join(repo, 'packages/contracts/generated/api/**/orpc.gen.ts'))]
for (const file of contractFiles.sort()) {
  // oxlint-disable-next-line antfu/no-top-level-await -- This CLI must load contract metadata before generating the audit.
  const exports = await import(pathToFileURL(file))
  const surface = consoleOnly
    ? 'console'
    : relative(join(repo, 'packages/contracts/generated/api'), file).split('/')[0]
  for (const [name, value] of Object.entries(exports)) {
    const def = value?.['~orpc']
    if (!def) continue
    const id = key(surface, def.route.method, def.route.path)
    assert(!contracts.has(id), `Duplicate generated procedure: ${id}`)
    contracts.set(id, {
      id,
      file: relative(repo, file),
      name,
      hasInputSchema: !!def.inputSchema,
      hasOutputSchema: !!def.outputSchema,
    })
  }
}
function* routes(node, members = []) {
  for (const [method, operation] of node.methods) yield { operation, members: [...members, method] }
  for (const [name, child] of node.children) yield* routes(child, [...members, name])
}
function deref(schema, spec) {
  while (schema?.$ref?.startsWith('#/'))
    schema = schema.$ref
      .slice(2)
      .split('/')
      .reduce((v, k) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], spec)
  return schema
}
const dir = mkdtempSync(join(root, 'integration/.compare-'))
const lines = []
const assertions = new Map()
const add = (text) => lines.push(text)
const check = (row, name, expression, expected = true) => {
  add(`const c${row}_${name}: ${expression} = ${expected};`)
  assertions.set(lines.length, { row, name, expected })
  report.matched[row].checks[name] = expected
}
try {
  add("type Schema = { '~standard': { types?: { input: unknown; output: unknown } } };")
  add("type Contract = { '~orpc': { inputSchema?: Schema; outputSchema?: Schema } };")
  add(
    "type Input<T extends Contract> = NonNullable<NonNullable<T['~orpc']['inputSchema']>['~standard']['types']>['input'];",
  )
  add(
    "type Output<T extends Contract> = NonNullable<NonNullable<T['~orpc']['outputSchema']>['~standard']['types']>['output'];",
  )
  add(
    "type WireOutput<T extends Contract> = NonNullable<NonNullable<T['~orpc']['outputSchema']>['~standard']['types']>['input'];",
  )
  add('type NormalizeVoid<T> = T extends void ? undefined : T;')
  add('type Ext<A,B> = [A] extends [B] ? true : false;')
  add('type Any<T> = 0 extends (1 & T) ? true : false;')
  add('type Unknown<T> = unknown extends T ? true : false;')
  add('type Never<T> = [T] extends [never] ? true : false;')
  add(
    'type Field<T,K extends PropertyKey> = T extends unknown ? K extends keyof T ? T[K] : undefined : never;',
  )
  add(
    "type RenameHeader<T> = T extends { header: infer H } ? Omit<T,'header'|'headers'> & { headers: H } : T extends { header?: infer H } ? Omit<T,'header'|'headers'> & { headers?: H } : T;",
  )
  add(
    "type SplitBody<T, B = T extends {body: infer Body} ? Body : never> = [B] extends [never] ? T : B extends unknown ? Omit<T,'body'> & {body:B} : never;",
  )
  add("type WithoutContentType<T> = T extends unknown ? Omit<T, 'contentType'> : never;")
  for (const [docIndex, name] of documents.entries()) {
    const file =
      name === 'knowledge-fs'
        ? join(repo, 'api/knowledge-fs-contract/knowledge-fs.openapi.json')
        : join(specDir, `${name}-openapi.json`)
    const bytes = consoleOnly ? JSON.stringify(loadConsoleDocument()) : readFileSync(file)
    const spec = JSON.parse(bytes)
    const inventory = [...routes(createRouter(describeOperations(spec)))]
    report.documents.push({
      name,
      operations: inventory.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    if (!consoleOnly) symlinkSync(file, join(dir, `${name}.openapi`))
    const specifier = consoleOnly
      ? join(repo, 'packages/openapi-content-mapper/examples/repository/console.openapi-source')
      : `./${name}.openapi`
    add(`import { api as api${docIndex} } from ${JSON.stringify(specifier)};`)
    for (const { operation, members } of inventory) {
      const surface = consoleOnly || name === 'fastopenapi-console' ? 'console' : name
      const path =
        name === 'fastopenapi-console'
          ? operation.path.replace(/^\/console\/api(?=\/|$)/, '') || '/'
          : operation.path
      const id = key(surface, operation.method, path)
      const contract = contracts.get(id)
      if (!contract) {
        report.unmatchedOpenApi.push({
          document: name,
          method: operation.method,
          path: operation.path,
          reason: ['inner', 'knowledge-fs'].includes(name)
            ? 'No generated/api oRPC surface exists'
            : 'No generated procedure for method and path',
          responseStatuses: Object.keys(
            spec.paths[operation.path][operation.method].responses ?? {},
          ),
        })
        continue
      }
      contracts.delete(id)
      const row = report.matched.length
      const op = spec.paths[operation.path][operation.method]
      const responses = Object.entries(op.responses ?? {})
        .filter(([status]) => /^2\d\d$/.test(status))
        .map(([status, r]) => ({ status, ...deref(r, spec) }))
      const content = deref(op.requestBody, spec)?.content ?? {}
      report.matched.push({
        id,
        document: name,
        path: operation.path,
        method: operation.method,
        sdkMembers: members,
        contract,
        traits: {
          requestMedia: Object.keys(content),
          responseMedia: [...new Set(responses.flatMap((r) => Object.keys(r.content ?? {})))],
          successStatuses: responses.map((r) => r.status),
          jsonBinaryResponse: responses.some((r) => {
            const schema = deref(r.content?.['application/json']?.schema, spec)
            return schema?.type === 'string' && schema.format === 'binary'
          }),
          opaqueResponse: responses.some(
            (r) =>
              !['204', '205'].includes(r.status) &&
              (!r.content || Object.values(r.content).some((m) => !m.schema)),
          ),
        },
        checks: {},
      })
      add(
        `import type { ${contract.name} as proc${row} } from ${JSON.stringify(resolve(repo, contract.file))};`,
      )
      add(
        `type S${row} = typeof api${docIndex}${members.map((k) => `[${JSON.stringify(k)}]`).join('')};`,
      )
      add(`type NI${row} = Parameters<S${row}>[0]; type NO${row} = Awaited<ReturnType<S${row}>>;`)
      add(`type OI${row} = Input<typeof proc${row}>; type OO${row} = Output<typeof proc${row}>;`)
      for (const [label, a, b] of [
        ['inputSdkToOrpc', `NI${row}`, `OI${row}`],
        ['inputOrpcToSdk', `OI${row}`, `NI${row}`],
        ['outputSdkToOrpc', `NO${row}`, `OO${row}`],
        ['outputOrpcToSdk', `OO${row}`, `NO${row}`],
      ])
        check(row, label, `Ext<${a},${b}>`)
      for (const [label, t] of [
        ['sdkInput', `NI${row}`],
        ['orpcInput', `OI${row}`],
        ['sdkOutput', `NO${row}`],
        ['orpcOutput', `OO${row}`],
      ]) {
        for (const guard of ['Any', 'Unknown', 'Never'])
          check(row, `${label}${guard}`, `${guard}<${t}>`, false)
      }
      check(row, 'renamedHeaderSdkToOrpc', `Ext<RenameHeader<NI${row}>,OI${row}>`)
      check(row, 'renamedHeaderOrpcToSdk', `Ext<OI${row},RenameHeader<NI${row}>>`)
      check(row, 'sdkOutputString', `Ext<NO${row},string>`)
      check(row, 'orpcOutputBlob', `Ext<OO${row},Blob>`)
      check(row, 'sdkAcceptsOmittedInput', `Ext<undefined,NI${row}>`)
      check(row, 'wireOutputSdkToOrpc', `Ext<NO${row},WireOutput<typeof proc${row}>>`)
      check(row, 'wireOutputOrpcToSdk', `Ext<WireOutput<typeof proc${row}>,NO${row}>`)
      check(row, 'normalizedVoidSdkToOrpc', `Ext<NormalizeVoid<NO${row}>,NormalizeVoid<OO${row}>>`)
      check(row, 'normalizedVoidOrpcToSdk', `Ext<NormalizeVoid<OO${row}>,NormalizeVoid<NO${row}>>`)
      for (const field of ['body', 'query', 'params', 'headers', 'header', 'cookie']) {
        check(
          row,
          `${field}SdkToOrpc`,
          `Ext<Field<NI${row},'${field}'>,Field<OI${row},'${field}'>>`,
        )
        check(
          row,
          `${field}OrpcToSdk`,
          `Ext<Field<OI${row},'${field}'>,Field<NI${row},'${field}'>>`,
        )
      }
      if (report.matched[row].traits.responseMedia.includes('text/event-stream')) {
        check(
          row,
          'nonStreamSdkToOrpc',
          `Ext<Exclude<NO${row},ReadableStream<Uint8Array>>,Exclude<OO${row},string>>`,
        )
        check(
          row,
          'nonStreamOrpcToSdk',
          `Ext<Exclude<OO${row},string>,Exclude<NO${row},ReadableStream<Uint8Array>>>`,
        )
      }
      if (report.matched[row].traits.responseMedia.includes('text/event-stream')) {
        check(
          row,
          'nonStreamWireSdkToOrpc',
          `Ext<Exclude<NO${row},ReadableStream<Uint8Array>>,Exclude<WireOutput<typeof proc${row}>,string>>`,
        )
        check(
          row,
          'nonStreamWireOrpcToSdk',
          `Ext<Exclude<WireOutput<typeof proc${row}>,string>,Exclude<NO${row},ReadableStream<Uint8Array>>>`,
        )
      }
      if (Object.keys(content).includes('multipart/form-data')) {
        check(row, 'withoutContentTypeSdkToOrpc', `Ext<WithoutContentType<NI${row}>,OI${row}>`)
        check(
          row,
          'withoutContentTypeOrpcToSdk',
          `Ext<SplitBody<OI${row}>,WithoutContentType<NI${row}>>`,
        )
        check(
          row,
          'multipartSdkToOrpc',
          `Ext<WithoutContentType<Extract<NI${row},{contentType?:'multipart/form-data'}>>,OI${row}>`,
        )
        check(
          row,
          'multipartOrpcToSdk',
          `Ext<OI${row},WithoutContentType<Extract<NI${row},{contentType?:'multipart/form-data'}>>>`,
        )
      }
    }
  }
  report.unmatchedOrpc = [...contracts.values()]
  writeFileSync(join(dir, 'check.ts'), lines.join('\n'))
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: 'ES2022',
        module: 'NodeNext',
        allowImportingTsExtensions: true,
        types: ['node'],
        lib: ['ES2022', 'DOM'],
      },
      contentMappers: [
        {
          package: root,
          extensions: ['.openapi', '.openapi-source'],
          options: {
            sources: consoleOnly
              ? [
                  join(
                    repo,
                    'packages/openapi-content-mapper/examples/repository/console.openapi-source',
                  ),
                ]
              : [],
          },
        },
      ],
      include: ['*.ts'],
    }),
  )
  const started = performance.now()
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--runExternalCode',
      '--pretty',
      'false',
      '-p',
      dir,
    ],
    { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 },
  )
  assert.ifError(result.error)
  assert(
    [0, 2].includes(result.status),
    `Compiler failed: ${result.status} ${result.signal}\n${result.stdout}\n${result.stderr}`,
  )
  for (const diagnostic of result.stdout.split('\n').filter(Boolean)) {
    const m = /check\.ts\((\d+),\d+\): error TS(\d+): (.*)/.exec(diagnostic)
    const assertion = m && assertions.get(Number(m[1]))
    if (
      assertion &&
      m[2] === '2322' &&
      /^Type '(?:true|false)' is not assignable to type '(?:true|false)'\.$/.test(m[3])
    )
      report.matched[assertion.row].checks[assertion.name] = !assertion.expected
    else report.compilerErrors.push({ diagnostic, source: m ? lines[Number(m[1]) - 1] : undefined })
  }
  if (result.stderr.trim()) report.compilerErrors.push({ diagnostic: result.stderr })
  for (const row of report.matched) {
    const c = row.checks
    row.inputCategory =
      c.inputSdkToOrpc && c.inputOrpcToSdk
        ? 'compatible'
        : !row.contract.hasInputSchema && c.orpcInputUnknown && c.sdkAcceptsOmittedInput
          ? 'no-input-schema'
          : c.renamedHeaderSdkToOrpc && c.renamedHeaderOrpcToSdk
            ? 'header-vs-headers'
            : c.withoutContentTypeSdkToOrpc && c.withoutContentTypeOrpcToSdk
              ? 'multipart-selection'
              : c.multipartSdkToOrpc && c.multipartOrpcToSdk
                ? 'multipart-selection'
                : 'schema-difference'
    row.outputCategory =
      c.outputSdkToOrpc && c.outputOrpcToSdk
        ? 'compatible'
        : c.normalizedVoidSdkToOrpc && c.normalizedVoidOrpcToSdk
          ? 'void-vs-undefined'
          : c.nonStreamSdkToOrpc && c.nonStreamOrpcToSdk
            ? 'raw-stream-vs-string'
            : c.nonStreamWireSdkToOrpc && c.nonStreamWireOrpcToSdk
              ? 'raw-stream-and-parsed-defaults'
              : c.wireOutputSdkToOrpc && c.wireOutputOrpcToSdk
                ? 'parsed-vs-wire-output'
                : row.traits.jsonBinaryResponse && c.sdkOutputString && c.orpcOutputBlob
                  ? 'json-binary-vs-blob'
                  : row.traits.opaqueResponse && c.sdkOutputUnknown
                    ? 'undocumented-output'
                    : 'schema-difference'
  }
  // Produce real assignability diagnostics for differences that remain after the
  // explicit representation checks. These are evidence, not inferred labels.
  if (!report.compilerErrors.length) {
    const detailLines = [...lines]
    for (const [line, { row, name }] of assertions)
      detailLines[line - 1] = detailLines[line - 1].replace(
        /= (?:true|false);$/,
        `= ${report.matched[row].checks[name]};`,
      )
    const details = new Map()
    for (const [i, row] of report.matched.entries()) {
      for (const [category, a, b] of [
        ['input', `NI${i}`, `OI${i}`],
        ['output', `NO${i}`, `OO${i}`],
        ['wireOutput', `NO${i}`, `WireOutput<typeof proc${i}>`],
      ]) {
        if (
          category === 'wireOutput'
            ? row.outputCategory !== 'schema-difference'
            : row[`${category}Category`] !== 'schema-difference' &&
              row[`${category}Category`] !== 'parsed-vs-wire-output'
        )
          continue
        for (const [direction, from, to] of [
          ['sdkToOrpc', a, b],
          ['orpcToSdk', b, a],
        ]) {
          detailLines.push(`const detail${i}_${category}_${direction}: ${to} = null! as ${from};`)
          details.set(detailLines.length, { row: i, category, direction })
        }
      }
    }
    writeFileSync(join(dir, 'check.ts'), detailLines.join('\n'))
    const diagnostics = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules/typescript/bin/tsc'),
        '--runExternalCode',
        '--pretty',
        'false',
        '-p',
        dir,
      ],
      { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 },
    )
    assert.ifError(diagnostics.error)
    assert(
      [0, 2].includes(diagnostics.status),
      `Diagnostic compilation failed: ${diagnostics.status}`,
    )
    for (const block of diagnostics.stdout
      .split(/(?=^.*check\.ts\(\d+,\d+\): error TS)/m)
      .filter(Boolean)) {
      const match = /check\.ts\((\d+),\d+\): error TS(\d+): ([\s\S]*)/.exec(block)
      const detail = match && details.get(Number(match[1]))
      if (!detail || !['2322', '2741', '2739', '2559'].includes(match[2]))
        report.compilerErrors.push({ diagnostic: block })
      else
        (report.matched[detail.row].diagnostics ??= []).push({
          category: detail.category,
          direction: detail.direction,
          message: match[3].trim(),
        })
    }
    if (diagnostics.stderr.trim()) report.compilerErrors.push({ diagnostic: diagnostics.stderr })
  }
  report.categories = { input: {}, output: {} }
  for (const row of report.matched)
    for (const kind of ['input', 'output']) {
      const category = row[`${kind}Category`]
      report.categories[kind][category] = (report.categories[kind][category] ?? 0) + 1
    }
  report.compilerMilliseconds = Math.round(performance.now() - started)
  report.valid = report.compilerErrors.length === 0
  report.summary = {
    matched: report.matched.length,
    fullyAssignable: report.matched.filter((r) =>
      ['inputSdkToOrpc', 'inputOrpcToSdk', 'outputSdkToOrpc', 'outputOrpcToSdk'].every(
        (k) => r.checks[k],
      ),
    ).length,
    inputMismatch: report.matched.filter(
      (r) => !r.checks.inputSdkToOrpc || !r.checks.inputOrpcToSdk,
    ).length,
    outputMismatch: report.matched.filter(
      (r) => !r.checks.outputSdkToOrpc || !r.checks.outputOrpcToSdk,
    ).length,
    unmatchedOpenApi: report.unmatchedOpenApi.length,
    unmatchedOrpc: report.unmatchedOrpc.length,
    compilerErrors: report.compilerErrors.length,
  }
  report.summary.topLevelAnyOrNever = report.matched.filter((r) =>
    Object.entries(r.checks).some(([k, v]) => /Any$|Never$/.test(k) && v),
  ).length
  report.summary.inputAndOutputMismatch = report.matched.filter(
    (r) =>
      (!r.checks.inputSdkToOrpc || !r.checks.inputOrpcToSdk) &&
      (!r.checks.outputSdkToOrpc || !r.checks.outputOrpcToSdk),
  ).length
  report.coverage = report.documents.map((d) => ({
    document: d.name,
    total: d.operations,
    compared: report.matched.filter((r) => r.document === d.name).length,
  }))
  const acceptedInputs = new Set(['compatible', 'no-input-schema', 'multipart-selection'])
  const acceptedOutputs = new Set([
    'compatible',
    'parsed-vs-wire-output',
    'undocumented-output',
    'raw-stream-vs-string',
    'raw-stream-and-parsed-defaults',
    'json-binary-vs-blob',
  ])
  report.summary.unexplainedDifferences = report.matched.filter(
    (row) => !acceptedInputs.has(row.inputCategory) || !acceptedOutputs.has(row.outputCategory),
  ).length
  mkdirSync(resolve(output, '..'), { recursive: true })
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(
    JSON.stringify(
      {
        ...report.summary,
        categories: report.categories,
        compilerMilliseconds: report.compilerMilliseconds,
        report: output,
      },
      null,
      2,
    ),
  )
  assert.equal(
    report.compilerErrors.length,
    0,
    'Unexpected compiler errors invalidate this audit; see report',
  )
  if (consoleOnly) {
    const baselinePath = join(root, 'integration/console-type-differences.json')
    const differences = Object.fromEntries(
      report.matched
        .filter((row) => row.inputCategory !== 'compatible' || row.outputCategory !== 'compatible')
        .map((row) => [row.id, [row.inputCategory, row.outputCategory]])
        .sort(([a], [b]) => a.localeCompare(b)),
    )
    if (updateBaseline) writeFileSync(baselinePath, `${JSON.stringify(differences, null, 2)}\n`)
    else
      assert.deepEqual(
        differences,
        JSON.parse(readFileSync(baselinePath, 'utf8')),
        'Console type differences changed; inspect the report before updating the reviewed baseline',
      )
  }
  if (enforceAlignment) {
    assert.equal(report.summary.topLevelAnyOrNever, 0, 'Vacuous types invalidate compatibility')
    assert.equal(
      report.summary.unexplainedDifferences,
      0,
      'Unexpected oRPC type differences; see report',
    )
    assert.equal(report.summary.unmatchedOrpc, 0, 'Every generated procedure must be compared')
    if (consoleOnly)
      assert.equal(
        report.summary.unmatchedOpenApi,
        0,
        'Every Console operation must have a contract',
      )
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
