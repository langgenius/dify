import { fileURLToPath } from 'node:url'
import { openapi } from '@dify/openapi-content-mapper/vite'
import { configDefaults, defineConfig, lazyPlugins } from 'vite-plus'
import { playwright } from 'vite-plus/test/browser-playwright'
import { customI18nHmrPlugin } from './plugins/vite/custom-i18n-hmr.ts'
import { i18nAnalysisPlugin } from './plugins/vite/i18n-analysis.ts'
import { getRootClientInjectTarget } from './plugins/vite/inject-target.ts'
import { nextStaticImageTestPlugin } from './plugins/vite/next-static-image-test.ts'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const isCI = !!process.env.CI
const rootClientInjectTarget = getRootClientInjectTarget(projectRoot)
const browserTestPattern = '{app,features}/**/*.browser.spec.{ts,tsx}'
// `--changed` follows source imports, so inputs outside the module graph rerun every test.
// Keep coverage-counted sources out of `?raw` imports: those report zero lines.
const forceRerunTriggers = [
  ...configDefaults.forceRerunTriggers,
  '**/pnpm-lock.yaml',
  '**/pnpm-workspace.yaml',
  '**/patches/**',
  // `tsconfigPaths` resolves aliases from these files.
  '**/web/tsconfig.json',
  '**/packages/tsconfig/**',
  // Specs read these from disk or copy them into a temporary project.
  '**/web/public/embed{,.min}.js',
  '**/web/i18n/locales/*/{skill,deployments}.json',
  '**/web/i18n/lib.{client,server}.ts',
  '**/web/app/route-metadata.ts',
  '**/web/scripts/check-i18n{.js,-values.ts}',
  // Tests and the Vite plugin load this workspace package from its built `dist`.
  '**/packages/openapi-content-mapper/src/**',
  // Browser setup loads global styles through CSS imports, which the module graph does not track.
  '**/web/app/styles/**',
  '**/web/themes/**',
  '**/web/app/components/base/{badge,premium-badge}/index.css',
  '**/packages/dify-ui/src/{styles,themes,plugins}/**',
]

export default defineConfig(({ command, mode, isPreview }) => {
  const isTest = mode === 'test'
  const isStorybook =
    process.env.STORYBOOK === 'true' ||
    process.argv.some((arg) => arg.toLowerCase().includes('storybook'))

  return {
    build: {
      // Match package.json's browserslist; these targets support native top-level await.
      target: ['chrome111', 'edge111', 'firefox128', 'safari16.4', 'ios16.4'],
    },
    plugins: lazyPlugins(async () => {
      const { default: react } = await import('@vitejs/plugin-react')

      if (isTest) return [openapi(), nextStaticImageTestPlugin({ projectRoot }), react()]

      if (isStorybook) return [openapi(), react()]

      const [{ default: tailwindcss }, { default: vinext }, { default: Inspect }] =
        await Promise.all([
          import('@tailwindcss/vite'),
          import('vinext'),
          import('vite-plugin-inspect'),
        ])

      const inspector =
        command === 'serve' && isPreview !== true
          ? (await import('code-inspector-plugin')).codeInspectorPlugin({
              bundler: 'vite',
              behavior: { locate: true, defaultAction: 'locate' },
            })
          : undefined

      return [
        openapi(),
        i18nAnalysisPlugin({
          adapters: [
            { module: 'i18n/lib.client.ts', exportName: 'useTranslation', namespaceArgument: 0 },
            {
              module: 'i18n/lib.server.ts',
              exportName: 'useTranslation',
              namespaceArgument: 0,
              implementationFunctions: ['getI18nConfig'],
            },
            { module: 'i18n/server.ts', exportName: 'getTranslation', namespaceArgument: 1 },
            {
              module: 'app/route-metadata.ts',
              exportName: 'getRouteMetadata',
              namespaceArgument: 0,
              selectorArgument: 1,
            },
          ],
        }),
        Inspect(),
        inspector,
        tailwindcss(),
        react(),
        vinext({ react: false }),
        customI18nHmrPlugin({ injectTarget: rootClientInjectTarget }),
        // reactGrabOpenFilePlugin({
        //   injectTarget: rootClientInjectTarget,
        //   projectRoot,
        // }),
      ]
    }),
    resolve: {
      tsconfigPaths: true,
      // Storybook's Next.js preset merges aliases as an object.
      alias: { '~@': projectRoot },
    },
    // vinext related config
    ...(!isTest && !isStorybook
      ? {
          optimizeDeps: {
            // Keep skipToken shared by the unbundled React Query and oRPC clients.
            exclude: ['@tanstack/react-query', '@tanstack/query-core'],
          },
          server: {
            port: 3000,
          },
        }
      : {}),

    // Vitest config
    test: {
      // Vitest 5 stores Browser Mode failure screenshots as attachments; CI uploads this directory on failure.
      attachmentsDir: './.vitest-browser/attachments',
      forceRerunTriggers,
      // boundary: Monaco's word highlighter schedules work on a 50 ms `Delayer` after cursor, focus
      // and content changes and never handles the promise it returns, so disposing an editor inside
      // that window rejects it with Monaco's `CancellationError`, which Monaco treats as expected.
      // Browser specs unmount right after their last interaction, so ignore only that rejection.
      onUnhandledError: (error) =>
        !(
          error.name === 'Canceled' &&
          error.message === 'Canceled' &&
          error.stack?.includes('/vs/editor/editor.main.js:')
        ),
      coverage: {
        provider: 'v8',
        // Unit uploads establish the full source denominator; browser uploads add executed code.
        include:
          process.env.DIFY_TEST_COVERAGE_ONLY_EXECUTED === 'true'
            ? undefined
            : ['**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}'],
        reporter: isCI ? ['json', 'json-summary'] : ['text', 'html', 'json', 'json-summary'],
        exclude: [
          // Test infrastructure and examples do not belong in the source denominator.
          '**/{__tests__,__mocks__}/**',
          '**/*.{spec,test,stories}.*',
          'test/**',
          'vitest*.setup.ts',
          // Declarations, generated sources, tool configuration, and build output.
          '**/*.d.{ts,mts,cts}',
          '**/*.{generated,gen}.*',
          'types/doc-paths.ts',
          '*.config.*',
          '.*/**',
          '**/dist/**',
          '{coverage,build,out,storybook-static}/**',
          // Keep public/embed.js, but omit its minified copy and vendored workers/editor.
          'public/**/*.min.{js,mjs}',
          'public/vs/**',
        ],
      },
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            pool: 'threads',
            environment: 'happy-dom',
            globals: true,
            setupFiles: ['./vitest.setup.ts'],
            exclude: [...configDefaults.exclude, browserTestPattern],
          },
        },
        {
          extends: true,
          define: {
            'process.env': '{}',
          },
          plugins: lazyPlugins(async () => {
            const { default: tailwindcss } = await import('@tailwindcss/vite')
            return [tailwindcss()]
          }),
          optimizeDeps: {
            include: [
              '@base-ui/react/collapsible',
              '@base-ui/react/fieldset',
              '@base-ui/react/number-field',
              '@base-ui/react/popover',
              '@base-ui/react/slider',
              '@lexical/react/LexicalExtensionComposer',
              'vite-plus/test/browser',
              'dayjs/plugin/relativeTime',
              'dayjs/plugin/timezone',
              'dayjs/plugin/utc',
              'es-toolkit/function',
              // Keep the router contexts shared with `next/navigation` for `test/next-navigation.tsx`.
              'next/dist/shared/lib/app-router-context.shared-runtime',
              'next/dist/shared/lib/hooks-client-context.shared-runtime',
              'next/navigation',
              'next/script',
              'react-textarea-autosize',
            ],
          },
          test: {
            name: 'browser',
            globals: true,
            setupFiles: ['./vitest.browser.setup.ts'],
            include: [browserTestPattern],
            browser: {
              enabled: true,
              // Pin what the host machine would otherwise decide, so local runs match CI.
              provider: playwright({
                // `TZ` instead of `timezoneId`: a context override would block the
                // per-spec `Emulation.setTimezoneOverride` behind `emulateTimezone`.
                launchOptions: { env: { ...process.env, TZ: 'UTC' } },
                contextOptions: {
                  locale: 'en-US',
                  reducedMotion: 'reduce',
                },
              }),
              instances: [{ browser: 'chromium' }],
              // Vitest's default, stated so specs and the setup file share one documented size.
              viewport: { width: 414, height: 896 },
              headless: true,
              // Keep application maps and mapped error stacks without sending dependency maps.
              dependencySourcemaps: false,
              screenshotFailures: true,
              trace: {
                // Recording zips every test on the Vitest main thread, even with
                // retain-on-failure, and roughly doubles CI time. Failure screenshots remain.
                mode: 'off',
                screenshots: false,
                tracesDir: './.vitest-browser/traces',
              },
            },
          },
        },
      ],
    },
  }
})
