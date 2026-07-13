// @ts-check

import path from 'node:path'
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments'
import markdown from '@eslint/markdown'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import md from 'eslint-markdown'
import antfu from 'eslint-plugin-antfu'
import tailwindcss from 'eslint-plugin-better-tailwindcss'
import command from 'eslint-plugin-command'
import erasableSyntaxOnly from 'eslint-plugin-erasable-syntax-only'
import hyoban from 'eslint-plugin-hyoban'
import importPlugin from 'eslint-plugin-import-lite'
import jsdoc from 'eslint-plugin-jsdoc'
import jsonc from 'eslint-plugin-jsonc'
import markdownPreferences from 'eslint-plugin-markdown-preferences'
import nodePlugin from 'eslint-plugin-n'
import perfectionist from 'eslint-plugin-perfectionist'
import pnpm from 'eslint-plugin-pnpm'
import regexp from 'eslint-plugin-regexp'
import toml from 'eslint-plugin-toml'
import unicorn from 'eslint-plugin-unicorn'
import unusedImports from 'eslint-plugin-unused-imports'
import yml from 'eslint-plugin-yml'
import { defineConfig, globalIgnores } from 'eslint/config'
import dify from './web/plugins/eslint/index.js'

const rootDir = import.meta.dirname
const javascriptFiles = ['**/*.{js,cjs,mjs,jsx}']
const typescriptFiles = ['**/*.{ts,cts,mts,tsx}']
const declarationFiles = ['**/*.d.{ts,cts,mts}']

const fallbackCoreRules = {
  // Oxlint 1.72 misses literal control characters that ESLint reports.
  'no-control-regex': 'error',
  'no-octal': 'error',
  'no-octal-escape': 'error',
  'no-undef-init': 'error',
  'no-unreachable-loop': 'error',
  'one-var': ['error', { initialized: 'never' }],
}

/**
 * Active rules from the pre-migration root ESLint config for declaration files.
 * Keep this snapshot explicit because Oxlint cannot safely run the same rules on these files.
 */
const declarationRules = {
  'accessor-pairs': [
    2,
    {
      enforceForTSTypes: false,
      enforceForClassMembers: true,
      getWithoutSet: false,
      setWithoutGet: true,
    },
  ],
  'antfu/import-dedupe': [2],
  'antfu/no-import-dist': [2],
  'antfu/no-import-node-modules-by-path': [2],
  'antfu/no-top-level-await': [2],
  'array-callback-return': [
    2,
    {
      allowImplicit: false,
      checkForEach: false,
      allowVoid: false,
    },
  ],
  'block-scoped-var': [2],
  'command/command': [2],
  'default-case-last': [2],
  'dot-notation': [
    2,
    {
      allowKeywords: true,
      allowPattern: '',
    },
  ],
  eqeqeq: [2, 'smart'],
  'erasable-syntax-only/enums': [2],
  'erasable-syntax-only/import-aliases': [2],
  'erasable-syntax-only/namespaces': [2],
  'erasable-syntax-only/parameter-properties': [2],
  'eslint-comments/no-aggregating-enable': [2],
  'eslint-comments/no-duplicate-disable': [2],
  'eslint-comments/no-unused-enable': [2],
  'import/consistent-type-specifier-style': [2, 'top-level'],
  'import/first': [2],
  'import/no-duplicates': [2],
  'import/no-mutable-exports': [2],
  'import/no-named-default': [2],
  'jsdoc/check-access': [1],
  'jsdoc/check-param-names': [1],
  'jsdoc/check-property-names': [1],
  'jsdoc/check-types': [1],
  'jsdoc/empty-tags': [1],
  'jsdoc/implements-on-classes': [1],
  'jsdoc/no-defaults': [1],
  'jsdoc/no-multi-asterisks': [1],
  'jsdoc/require-param-name': [1],
  'jsdoc/require-property': [1],
  'jsdoc/require-property-description': [1],
  'jsdoc/require-property-name': [1],
  'jsdoc/require-returns-check': [1],
  'jsdoc/require-returns-description': [1],
  'jsdoc/require-yields-check': [1],
  'new-cap': [
    2,
    {
      capIsNew: false,
      capIsNewExceptions: [
        'Array',
        'Boolean',
        'Date',
        'Error',
        'Function',
        'Number',
        'Object',
        'RegExp',
        'String',
        'Symbol',
        'BigInt',
      ],
      newIsCap: true,
      newIsCapExceptions: [],
      properties: true,
    },
  ],
  'no-alert': [2],
  'no-async-promise-executor': [2],
  'no-caller': [2],
  'no-case-declarations': [2],
  'no-compare-neg-zero': [2],
  'no-cond-assign': [2, 'always'],
  'no-console': [
    2,
    {
      allow: ['warn', 'error'],
    },
  ],
  'no-control-regex': [2],
  'no-debugger': [2],
  'no-delete-var': [2],
  'no-duplicate-case': [2],
  'no-empty': [
    2,
    {
      allowEmptyCatch: true,
    },
  ],
  'no-empty-pattern': [
    2,
    {
      allowObjectPatternsAsParameters: false,
    },
  ],
  'no-eval': [
    2,
    {
      allowIndirect: false,
    },
  ],
  'no-ex-assign': [2],
  'no-extend-native': [
    2,
    {
      exceptions: [],
    },
  ],
  'no-extra-bind': [2],
  'no-extra-boolean-cast': [2, {}],
  'no-fallthrough': [
    2,
    {
      allowEmptyCase: false,
      reportUnusedFallthroughComment: false,
    },
  ],
  'no-global-assign': [
    2,
    {
      exceptions: [],
    },
  ],
  'no-implied-eval': [2],
  'no-irregular-whitespace': [
    2,
    {
      skipComments: false,
      skipJSXText: false,
      skipRegExps: false,
      skipStrings: true,
      skipTemplates: false,
    },
  ],
  'no-iterator': [2],
  'no-labels': [
    2,
    {
      allowLoop: false,
      allowSwitch: false,
    },
  ],
  'no-lone-blocks': [2],
  'no-loss-of-precision': [2],
  'no-misleading-character-class': [
    2,
    {
      allowEscape: false,
    },
  ],
  'no-multi-str': [2],
  'no-new': [2],
  'no-new-func': [2],
  'no-new-wrappers': [2],
  'no-octal': [2],
  'no-octal-escape': [2],
  'no-proto': [2],
  'no-prototype-builtins': [2],
  'no-regex-spaces': [2],
  'no-restricted-globals': [
    2,
    {
      message: 'Use `globalThis` instead.',
      name: 'global',
    },
    {
      message: 'Use `globalThis` instead.',
      name: 'self',
    },
  ],
  'no-restricted-properties': [
    2,
    {
      message: 'Use `Object.getPrototypeOf` or `Object.setPrototypeOf` instead.',
      property: '__proto__',
    },
    {
      message: 'Use `Object.defineProperty` instead.',
      property: '__defineGetter__',
    },
    {
      message: 'Use `Object.defineProperty` instead.',
      property: '__defineSetter__',
    },
    {
      message: 'Use `Object.getOwnPropertyDescriptor` instead.',
      property: '__lookupGetter__',
    },
    {
      message: 'Use `Object.getOwnPropertyDescriptor` instead.',
      property: '__lookupSetter__',
    },
  ],
  'no-self-assign': [
    2,
    {
      props: true,
    },
  ],
  'no-self-compare': [2],
  'no-sequences': [
    2,
    {
      allowInParentheses: true,
    },
  ],
  'no-shadow-restricted-names': [
    2,
    {
      reportGlobalThis: true,
    },
  ],
  'no-sparse-arrays': [2],
  'no-template-curly-in-string': [2],
  'no-throw-literal': [2],
  'no-undef-init': [2],
  'no-unexpected-multiline': [2],
  'no-unmodified-loop-condition': [2],
  'no-unneeded-ternary': [
    2,
    {
      defaultAssignment: false,
    },
  ],
  'no-unreachable-loop': [
    2,
    {
      ignore: [],
    },
  ],
  'no-unsafe-finally': [2],
  'no-useless-call': [2],
  'no-useless-catch': [2],
  'no-useless-computed-key': [
    2,
    {
      enforceForClassMembers: true,
    },
  ],
  'no-useless-rename': [
    2,
    {
      ignoreDestructuring: false,
      ignoreImport: false,
      ignoreExport: false,
    },
  ],
  'no-useless-return': [2],
  'no-var': [2],
  'node/handle-callback-err': [2, '^(err|error)$'],
  'node/no-deprecated-api': [2],
  'node/no-exports-assign': [2],
  'node/no-new-require': [2],
  'node/no-path-concat': [2],
  'node/prefer-global/buffer': [2, 'never'],
  'node/process-exit-as-throw': [2],
  'object-shorthand': [
    2,
    'always',
    {
      avoidQuotes: true,
      ignoreConstructors: false,
    },
  ],
  'one-var': [
    2,
    {
      initialized: 'never',
    },
  ],
  'perfectionist/sort-exports': [
    2,
    {
      order: 'asc',
      type: 'natural',
    },
  ],
  'perfectionist/sort-named-exports': [
    2,
    {
      order: 'asc',
      type: 'natural',
    },
  ],
  'perfectionist/sort-named-imports': [
    2,
    {
      order: 'asc',
      type: 'natural',
    },
  ],
  'prefer-arrow-callback': [
    2,
    {
      allowNamedFunctions: false,
      allowUnboundThis: true,
    },
  ],
  'prefer-const': [
    2,
    {
      destructuring: 'all',
      ignoreReadBeforeAssign: true,
    },
  ],
  'prefer-exponentiation-operator': [2],
  'prefer-promise-reject-errors': [
    2,
    {
      allowEmptyReject: false,
    },
  ],
  'prefer-regex-literals': [
    2,
    {
      disallowRedundantWrapping: true,
    },
  ],
  'prefer-rest-params': [2],
  'prefer-spread': [2],
  'prefer-template': [2],
  'regexp/confusing-quantifier': [1],
  'regexp/control-character-escape': [2],
  'regexp/match-any': [2],
  'regexp/negation': [2],
  'regexp/no-contradiction-with-assertion': [2],
  'regexp/no-dupe-characters-character-class': [2],
  'regexp/no-dupe-disjunctions': [2],
  'regexp/no-empty-alternative': [1],
  'regexp/no-empty-capturing-group': [2],
  'regexp/no-empty-character-class': [2],
  'regexp/no-empty-group': [2],
  'regexp/no-empty-lookarounds-assertion': [2],
  'regexp/no-empty-string-literal': [2],
  'regexp/no-escape-backspace': [2],
  'regexp/no-extra-lookaround-assertions': [2],
  'regexp/no-invalid-regexp': [2],
  'regexp/no-invisible-character': [2],
  'regexp/no-lazy-ends': [1],
  'regexp/no-legacy-features': [2],
  'regexp/no-misleading-capturing-group': [2],
  'regexp/no-misleading-unicode-character': [2],
  'regexp/no-missing-g-flag': [2],
  'regexp/no-non-standard-flag': [2],
  'regexp/no-obscure-range': [2],
  'regexp/no-optional-assertion': [2],
  'regexp/no-potentially-useless-backreference': [1],
  'regexp/no-super-linear-backtracking': [2],
  'regexp/no-trivially-nested-assertion': [2],
  'regexp/no-trivially-nested-quantifier': [2],
  'regexp/no-unused-capturing-group': [2],
  'regexp/no-useless-assertions': [2],
  'regexp/no-useless-backreference': [2],
  'regexp/no-useless-character-class': [2],
  'regexp/no-useless-dollar-replacements': [2],
  'regexp/no-useless-escape': [2],
  'regexp/no-useless-flag': [1],
  'regexp/no-useless-lazy': [2],
  'regexp/no-useless-non-capturing-group': [2],
  'regexp/no-useless-quantifier': [2],
  'regexp/no-useless-range': [2],
  'regexp/no-useless-set-operand': [2],
  'regexp/no-useless-string-literal': [2],
  'regexp/no-useless-two-nums-quantifier': [2],
  'regexp/no-zero-quantifier': [2],
  'regexp/optimal-lookaround-quantifier': [1],
  'regexp/optimal-quantifier-concatenation': [2],
  'regexp/prefer-character-class': [2],
  'regexp/prefer-d': [2],
  'regexp/prefer-plus-quantifier': [2],
  'regexp/prefer-predefined-assertion': [2],
  'regexp/prefer-question-quantifier': [2],
  'regexp/prefer-range': [2],
  'regexp/prefer-set-operation': [2],
  'regexp/prefer-star-quantifier': [2],
  'regexp/prefer-unicode-codepoint-escapes': [2],
  'regexp/prefer-w': [2],
  'regexp/simplify-set-operations': [2],
  'regexp/sort-flags': [2],
  'regexp/strict': [2],
  'regexp/use-ignore-case': [2],
  'symbol-description': [2],
  'ts/ban-ts-comment': [
    2,
    {
      'ts-expect-error': 'allow-with-description',
    },
  ],
  'ts/consistent-type-definitions': [2, 'type'],
  'ts/consistent-type-imports': [
    2,
    {
      disallowTypeAnnotations: false,
      fixStyle: 'separate-type-imports',
      prefer: 'type-imports',
    },
  ],
  'ts/method-signature-style': [2, 'property'],
  'ts/no-array-constructor': [2],
  'ts/no-dupe-class-members': [2],
  'ts/no-duplicate-enum-values': [2],
  'ts/no-empty-object-type': [
    2,
    {
      allowInterfaces: 'always',
    },
  ],
  'ts/no-explicit-any': [2],
  'ts/no-extra-non-null-assertion': [2],
  'ts/no-import-type-side-effects': [2],
  'ts/no-misused-new': [2],
  'ts/no-namespace': [2],
  'ts/no-non-null-asserted-nullish-coalescing': [2],
  'ts/no-non-null-asserted-optional-chain': [2],
  'ts/no-require-imports': [2],
  'ts/no-this-alias': [2],
  'ts/no-unnecessary-type-constraint': [2],
  'ts/no-unsafe-declaration-merging': [2],
  'ts/no-unsafe-function-type': [2],
  'ts/no-unused-expressions': [
    2,
    {
      allowShortCircuit: true,
      allowTaggedTemplates: true,
      allowTernary: true,
    },
  ],
  'ts/no-use-before-define': [
    2,
    {
      classes: false,
      functions: false,
      variables: true,
    },
  ],
  'ts/no-wrapper-object-types': [2],
  'ts/prefer-as-const': [2],
  'ts/prefer-literal-enum-member': [2],
  'ts/prefer-namespace-keyword': [2],
  'unicode-bom': [2, 'never'],
  'unicorn/consistent-empty-array-spread': [2],
  'unicorn/error-message': [2],
  'unicorn/escape-case': [2, 'uppercase'],
  'unicorn/new-for-builtins': [2],
  'unicorn/no-instanceof-builtins': [
    2,
    {
      useErrorIsError: false,
      strategy: 'loose',
      include: [],
      exclude: [],
    },
  ],
  'unicorn/no-new-array': [2],
  'unicorn/no-new-buffer': [2],
  'unicorn/prefer-dom-node-text-content': [2],
  'unicorn/prefer-includes': [2],
  'unicorn/prefer-node-protocol': [2],
  'unicorn/prefer-number-properties': [
    2,
    {
      checkInfinity: false,
      checkNaN: false,
    },
  ],
  'unicorn/prefer-string-starts-ends-with': [2],
  'unicorn/prefer-type-error': [2],
  'unicorn/throw-new-error': [2],
  'unused-imports/no-unused-imports': [2],
  'use-isnan': [
    2,
    {
      enforceForIndexOf: true,
      enforceForSwitchCase: true,
    },
  ],
  'valid-typeof': [
    2,
    {
      requireStringLiterals: true,
    },
  ],
  'vars-on-top': [2],
  yoda: [
    2,
    'never',
    {
      exceptRange: false,
      onlyEquality: false,
    },
  ],
}
const tsconfigCompilerOptionsOrder = [
  'incremental',
  'composite',
  'tsBuildInfoFile',
  'disableSourceOfProjectReferenceRedirect',
  'disableSolutionSearching',
  'disableReferencedProjectLoad',
  'target',
  'jsx',
  'jsxFactory',
  'jsxFragmentFactory',
  'jsxImportSource',
  'lib',
  'moduleDetection',
  'noLib',
  'reactNamespace',
  'useDefineForClassFields',
  'emitDecoratorMetadata',
  'experimentalDecorators',
  'libReplacement',
  'baseUrl',
  'rootDir',
  'rootDirs',
  'customConditions',
  'module',
  'moduleResolution',
  'moduleSuffixes',
  'noResolve',
  'paths',
  'resolveJsonModule',
  'resolvePackageJsonExports',
  'resolvePackageJsonImports',
  'typeRoots',
  'types',
  'allowArbitraryExtensions',
  'allowImportingTsExtensions',
  'allowUmdGlobalAccess',
  'allowJs',
  'checkJs',
  'maxNodeModuleJsDepth',
  'strict',
  'strictBindCallApply',
  'strictFunctionTypes',
  'strictNullChecks',
  'strictPropertyInitialization',
  'allowUnreachableCode',
  'allowUnusedLabels',
  'alwaysStrict',
  'exactOptionalPropertyTypes',
  'noFallthroughCasesInSwitch',
  'noImplicitAny',
  'noImplicitOverride',
  'noImplicitReturns',
  'noImplicitThis',
  'noPropertyAccessFromIndexSignature',
  'noUncheckedIndexedAccess',
  'noUnusedLocals',
  'noUnusedParameters',
  'useUnknownInCatchVariables',
  'declaration',
  'declarationDir',
  'declarationMap',
  'downlevelIteration',
  'emitBOM',
  'emitDeclarationOnly',
  'importHelpers',
  'importsNotUsedAsValues',
  'inlineSourceMap',
  'inlineSources',
  'mapRoot',
  'newLine',
  'noEmit',
  'noEmitHelpers',
  'noEmitOnError',
  'outDir',
  'outFile',
  'preserveConstEnums',
  'preserveValueImports',
  'removeComments',
  'sourceMap',
  'sourceRoot',
  'stripInternal',
  'allowSyntheticDefaultImports',
  'esModuleInterop',
  'forceConsistentCasingInFileNames',
  'isolatedDeclarations',
  'isolatedModules',
  'preserveSymlinks',
  'verbatimModuleSyntax',
  'erasableSyntaxOnly',
  'skipDefaultLibCheck',
  'skipLibCheck',
]

const pnpmWorkspaceOrder = [
  'cacheDir',
  'catalogMode',
  'cleanupUnusedCatalogs',
  'dedupeDirectDeps',
  'deployAllFiles',
  'enablePrePostScripts',
  'engineStrict',
  'extendNodePath',
  'hoist',
  'hoistPattern',
  'hoistWorkspacePackages',
  'ignoreCompatibilityDb',
  'ignoreDepScripts',
  'ignoreScripts',
  'ignoreWorkspaceRootCheck',
  'managePackageManagerVersions',
  'minimumReleaseAge',
  'minimumReleaseAgeExclude',
  'modulesDir',
  'nodeLinker',
  'nodeVersion',
  'optimisticRepeatInstall',
  'packageManagerStrict',
  'packageManagerStrictVersion',
  'preferSymlinkedExecutables',
  'preferWorkspacePackages',
  'publicHoistPattern',
  'registrySupportsTimeField',
  'requiredScripts',
  'resolutionMode',
  'savePrefix',
  'scriptShell',
  'shamefullyHoist',
  'shellEmulator',
  'stateDir',
  'supportedArchitectures',
  'symlink',
  'tag',
  'trustPolicy',
  'trustPolicyExclude',
  'updateNotifier',
  'packages',
  'overrides',
  'patchedDependencies',
  'catalog',
  'catalogs',
  'allowedDeprecatedVersions',
  'allowNonAppliedPatches',
  'configDependencies',
  'ignoredBuiltDependencies',
  'ignoredOptionalDependencies',
  'neverBuiltDependencies',
  'onlyBuiltDependencies',
  'onlyBuiltDependenciesFile',
  'packageExtensions',
  'peerDependencyRules',
]

export default defineConfig([
  globalIgnores([
    '.agents/**',
    '.claude/**',
    '.devcontainer/**',
    '.github/**',
    '.vscode/**',
    'api/**',
    'cli/context/**',
    'cli/coverage/**',
    'cli/dist/**',
    'cli/docs/**',
    'dify-agent/**',
    'docker/**',
    'docs/**',
    'scripts/**',
    'sdks/php-client/**',
    'sdks/python-client/**',
    '**/.next/**',
    '**/.vinext/**',
    '**/coverage/**',
    '**/dist/**',
    '**/storybook-static/**',
    'e2e/.auth/**',
    'e2e/cucumber-report/**',
    'packages/contracts/generated/**',
    'packages/contracts/openapi/**',
    'web/next/**',
    'web/next-env.d.ts',
    'web/public/**',
    'web/types/doc-paths.ts',
    'eslint-suppressions.json',
    'oxlint-suppressions.json',
  ]),
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
  },
  {
    files: javascriptFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      sourceType: 'module',
    },
    rules: {
      ...fallbackCoreRules,
      'dot-notation': ['error', { allowKeywords: true }],
    },
  },
  {
    files: typescriptFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      parser: tsParser,
      sourceType: 'module',
    },
    rules: {
      ...fallbackCoreRules,
    },
  },
  {
    files: declarationFiles,
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
    },
    plugins: {
      antfu,
      command,
      'erasable-syntax-only': erasableSyntaxOnly,
      'eslint-comments': eslintComments,
      import: importPlugin,
      jsdoc,
      node: nodePlugin,
      perfectionist,
      regexp,
      ts: tsPlugin,
      unicorn,
      'unused-imports': unusedImports,
    },
    rules: {
      ...declarationRules,
    },
  },
  {
    files: ['cli/src/**/*.d.{ts,cts,mts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../**', './*/**', '..'],
              message:
                'Use the @/ (or @test/) alias for parent-directory or nested relative imports; keep ./ only for same-folder siblings.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{json,json5,jsonc}'],
    language: 'jsonc/x',
    plugins: {
      jsonc,
    },
    rules: {
      'no-unused-expressions': 'off',
      'no-unused-vars': 'off',
      strict: 'off',
      'jsonc/no-bigint-literals': 'error',
      'jsonc/no-binary-expression': 'error',
      'jsonc/no-binary-numeric-literals': 'error',
      'jsonc/no-dupe-keys': 'error',
      'jsonc/no-escape-sequence-in-identifier': 'error',
      'jsonc/no-floating-decimal': 'error',
      'jsonc/no-hexadecimal-numeric-literals': 'error',
      'jsonc/no-infinity': 'error',
      'jsonc/no-multi-str': 'error',
      'jsonc/no-nan': 'error',
      'jsonc/no-number-props': 'error',
      'jsonc/no-numeric-separators': 'error',
      'jsonc/no-octal': 'error',
      'jsonc/no-octal-escape': 'error',
      'jsonc/no-octal-numeric-literals': 'error',
      'jsonc/no-parenthesized': 'error',
      'jsonc/no-plus-sign': 'error',
      'jsonc/no-regexp-literals': 'error',
      'jsonc/no-sparse-arrays': 'error',
      'jsonc/no-template-literals': 'error',
      'jsonc/no-undefined-value': 'error',
      'jsonc/no-unicode-codepoint-escapes': 'error',
      'jsonc/no-useless-escape': 'error',
      'jsonc/valid-json-number': 'error',
      'jsonc/vue-custom-block/no-parsing-error': 'error',
    },
  },
  {
    files: ['**/package.json'],
    rules: {
      'jsonc/sort-array-values': [
        'error',
        {
          order: { type: 'asc' },
          pathPattern: '^files$',
        },
      ],
    },
  },
  {
    files: ['**/[jt]sconfig.json', '**/[jt]sconfig.*.json'],
    rules: {
      'jsonc/sort-keys': [
        'error',
        {
          order: ['extends', 'compilerOptions', 'references', 'files', 'include', 'exclude'],
          pathPattern: '^$',
        },
        {
          order: tsconfigCompilerOptionsOrder,
          pathPattern: '^compilerOptions$',
        },
      ],
    },
  },
  {
    files: ['package.json', '**/package.json'],
    plugins: {
      pnpm,
    },
    rules: {
      'pnpm/json-enforce-catalog': [
        'error',
        {
          autofix: true,
          ignores: ['@types/vscode'],
        },
      ],
      'pnpm/json-prefer-workspace-settings': ['error', { autofix: true }],
      'pnpm/json-valid-catalog': ['error', { autofix: true }],
    },
  },
  {
    files: ['**/*.{yml,yaml}'],
    language: 'yml/yaml',
    plugins: {
      yml,
    },
    rules: {
      'no-irregular-whitespace': 'off',
      'no-unused-vars': 'off',
      'spaced-comment': 'off',
      'yml/no-empty-key': 'error',
      'yml/no-empty-sequence-entry': 'error',
      'yml/no-irregular-whitespace': 'error',
      'yml/vue-custom-block/no-parsing-error': 'error',
    },
  },
  {
    files: ['pnpm-workspace.yaml'],
    plugins: {
      pnpm,
    },
    rules: {
      'pnpm/yaml-enforce-settings': [
        'error',
        {
          settings: {
            shellEmulator: true,
            trustPolicy: 'no-downgrade',
          },
        },
      ],
      'pnpm/yaml-no-duplicate-catalog-item': 'error',
      'pnpm/yaml-no-unused-catalog-item': 'error',
      'yml/sort-keys': [
        'error',
        {
          order: pnpmWorkspaceOrder,
          pathPattern: '^$',
        },
        {
          order: { type: 'asc' },
          pathPattern: '.*',
        },
      ],
    },
  },
  {
    files: ['**/*.toml'],
    language: 'toml/toml',
    plugins: {
      toml,
    },
    rules: {
      'no-irregular-whitespace': 'off',
      'spaced-comment': 'off',
      'toml/keys-order': 'error',
      'toml/no-unreadable-number-separator': 'error',
      'toml/precision-of-fractional-seconds': 'error',
      'toml/precision-of-integer': 'error',
      'toml/tables-order': 'error',
      'toml/vue-custom-block/no-parsing-error': 'error',
    },
  },
  {
    files: ['**/*.md'],
    language: 'markdown/gfm',
    plugins: {
      markdown,
      'markdown-preferences': markdownPreferences,
      md,
    },
    rules: {
      'markdown/fenced-code-language': 'off',
      'markdown/heading-increment': 'error',
      'markdown/no-duplicate-definitions': 'error',
      'markdown/no-empty-definitions': 'error',
      'markdown/no-empty-images': 'error',
      'markdown/no-empty-links': 'error',
      'markdown/no-invalid-label-refs': 'error',
      'markdown/no-missing-atx-heading-space': 'error',
      'markdown/no-missing-label-refs': 'off',
      'markdown/no-missing-link-fragments': 'error',
      'markdown/no-multiple-h1': 'error',
      'markdown/no-reference-like-urls': 'error',
      'markdown/no-reversed-media-syntax': 'error',
      'markdown/no-space-in-emphasis': 'error',
      'markdown/no-unused-definitions': 'error',
      'markdown/require-alt-text': 'error',
      'markdown/table-column-count': 'error',
      'markdown-preferences/definitions-last': 'error',
      'markdown-preferences/prefer-link-reference-definitions': [
        'error',
        {
          minLinks: 1,
        },
      ],
      'markdown-preferences/sort-definitions': 'error',
      'md/no-url-trailing-slash': 'error',
    },
  },
  {
    files: ['web/i18n/**/*.json'],
    plugins: {
      dify,
      hyoban,
    },
    rules: {
      'dify/consistent-placeholders': 'error',
      'dify/no-extra-keys': 'error',
      'hyoban/i18n-flat-key': 'error',
      'jsonc/sort-keys': 'error',
    },
  },
  {
    files: ['packages/dify-ui/**/*.{ts,tsx}'],
    ignores: [
      'packages/dify-ui/**/__tests__/**',
      'packages/dify-ui/**/*.spec.{ts,tsx}',
      'packages/dify-ui/**/*.test.{ts,tsx}',
    ],
    plugins: {
      tailwindcss,
    },
    settings: {
      'better-tailwindcss': {
        cwd: path.resolve(rootDir, 'packages/dify-ui'),
        entryPoint: path.resolve(rootDir, 'packages/dify-ui/.storybook/storybook.css'),
      },
    },
    rules: {
      'tailwindcss/no-deprecated-classes': 'error',
      'tailwindcss/no-duplicate-classes': 'error',
      'tailwindcss/no-unknown-classes': 'error',
    },
  },
  {
    files: ['packages/dify-ui/**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}'],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
])
