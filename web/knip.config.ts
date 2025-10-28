import type { KnipConfig } from 'knip'

/**
 * Knip Configuration for Dead Code Detection
 *
 * This configuration helps identify unused files, exports, and dependencies
 * in the Dify web application (Next.js 15 + TypeScript + React 19).
 *
 * ⚠️ SAFETY FIRST: This configuration is designed to be conservative and
 * avoid false positives that could lead to deleting actively used code.
 *
 * @see https://knip.dev/reference/configuration
 */
const config: KnipConfig = {
  // ============================================================================
  // Next.js Framework Configuration
  // ============================================================================
  // Configure entry points specific to Next.js application structure.
  // These files are automatically treated as entry points by the framework.
  next: {
    entry: [
      // Next.js App Router pages (must exist for routing)
      'app/**/page.tsx',
      'app/**/layout.tsx',
      'app/**/loading.tsx',
      'app/**/error.tsx',
      'app/**/not-found.tsx',
      'app/**/template.tsx',
      'app/**/default.tsx',

      // Middleware (runs before every route)
      'middleware.ts',

      // Configuration files
      'next.config.js',
      'tailwind.config.js',
      'tailwind-common-config.ts',
      'postcss.config.js',

      // Testing configuration
      'jest.config.ts',
      'jest.setup.ts',

      // Linting configuration
      'eslint.config.mjs',
    ],
  },

  // ============================================================================
  // Global Entry Points
  // ============================================================================
  // Files that serve as entry points for the application.
  // The '!' suffix means these patterns take precedence and are always included.
  entry: [
    // Next.js App Router patterns (high priority)
    'app/**/page.tsx!',
    'app/**/layout.tsx!',
    'app/**/loading.tsx!',
    'app/**/error.tsx!',
    'app/**/not-found.tsx!',
    'app/**/template.tsx!',
    'app/**/default.tsx!',

    // Core configuration files
    'middleware.ts!',
    'next.config.js!',
    'tailwind.config.js!',
    'tailwind-common-config.ts!',
    'postcss.config.js!',

    // Testing setup
    'jest.config.ts!',
    'jest.setup.ts!',

    // Linting setup
    'eslint.config.mjs!',

    // ========================================================================
    // 🔒 CRITICAL: Global Initializers and Providers
    // ========================================================================
    // These files are imported by root layout.tsx and provide global functionality.
    // Even if not directly imported elsewhere, they are essential for app initialization.

    // Browser initialization (runs on client startup)
    'app/components/browser-initializer.tsx!',
    'app/components/sentry-initializer.tsx!',
    'app/components/swr-initializer.tsx!',

    // i18n initialization (server and client)
    'app/components/i18n.tsx!',
    'app/components/i18n-server.tsx!',

    // Route prefix handling (used in root layout)
    'app/routePrefixHandle.tsx!',

    // ========================================================================
    // 🔒 CRITICAL: Context Providers
    // ========================================================================
    // Context providers might be used via React Context API and imported dynamically.
    // Protecting all context files to prevent breaking the provider chain.
    'context/**/*.ts?(x)!',

    // Component-level contexts (also used via React.useContext)
    'app/components/**/*.context.ts?(x)!',

    // ========================================================================
    // 🔒 CRITICAL: State Management Stores
    // ========================================================================
    // Zustand stores might be imported dynamically or via hooks.
    // These are often imported at module level, so they should be protected.
    'app/components/**/*.store.ts?(x)!',
    'context/**/*.store.ts?(x)!',

    // ========================================================================
    // 🔒 CRITICAL: Provider Components
    // ========================================================================
    // Provider components wrap the app and provide global state/functionality
    'app/components/**/*.provider.ts?(x)!',
    'context/**/*.provider.ts?(x)!',

    // ========================================================================
    // Development tools
    // ========================================================================
    // Storybook configuration
    '.storybook/**/*',
  ],

  // ============================================================================
  // Project Files to Analyze
  // ============================================================================
  // Glob patterns for files that should be analyzed for unused code.
  // Excludes test files to avoid false positives.
  project: [
    '**/*.{js,jsx,ts,tsx,mjs,cjs}',
  ],

  // ============================================================================
  // Ignored Files and Directories
  // ============================================================================
  // Files and directories that should be completely excluded from analysis.
  // These typically contain:
  // - Test files
  // - Internationalization files (loaded dynamically)
  // - Static assets
  // - Build outputs
  // - External libraries
  ignore: [
    // Test files and directories
    '**/__tests__/**',
    '**/*.spec.{ts,tsx}',
    '**/*.test.{ts,tsx}',

    // ========================================================================
    // 🔒 CRITICAL: i18n Files (Dynamically Loaded)
    // ========================================================================
    // Internationalization files are loaded dynamically at runtime via i18next.
    // Pattern: import(`@/i18n/${locale}/messages`)
    // These will NEVER show up in static analysis but are essential!
    'i18n/**',

    // ========================================================================
    // 🔒 CRITICAL: Static Assets
    // ========================================================================
    // Static assets are referenced by URL in the browser, not via imports.
    // Examples: /logo.png, /icons/*, /embed.js
    'public/**',

    // Build outputs and caches
    'node_modules/**',
    '.next/**',
    'coverage/**',

    // Development tools
    '**/*.stories.{ts,tsx}',

    // ========================================================================
    // 🔒 Utility scripts (not part of application runtime)
    // ========================================================================
    // These scripts are run manually (e.g., pnpm gen-icons, pnpm check-i18n)
    // and are not imported by the application code.
    'scripts/**',
    'bin/**',
    'i18n-config/**',

    // Icon generation script (generates components, not used in runtime)
    'app/components/base/icons/script.mjs',
  ],

  // ============================================================================
  // Ignored Dependencies
  // ============================================================================
  // Dependencies that are used but not directly imported in code.
  // These are typically:
  // - Build tools
  // - Plugins loaded by configuration files
  // - CLI tools
  ignoreDependencies: [
    // ========================================================================
    // Next.js plugins (loaded by next.config.js)
    // ========================================================================
    'next-pwa',
    '@next/bundle-analyzer',
    '@next/mdx',

    // ========================================================================
    // Build tools (used by webpack/next.js build process)
    // ========================================================================
    'code-inspector-plugin',

    // ========================================================================
    // Development and translation tools (used by scripts)
    // ========================================================================
    'bing-translate-api',
    'uglify-js',
    'magicast',
  ],

  // ============================================================================
  // Export Analysis Configuration
  // ============================================================================
  // Configure how exports are analyzed

  // Ignore exports that are only used within the same file
  // (e.g., helper functions used internally in the same module)
  ignoreExportsUsedInFile: true,

  // ⚠️ SAFETY: Include exports from entry files in the analysis
  // This helps find unused public APIs, but be careful with:
  // - Context exports (useContext hooks)
  // - Store exports (useStore hooks)
  // - Type exports (might be used in other files)
  includeEntryExports: true,

  // ============================================================================
  // Ignored Binaries
  // ============================================================================
  // Binary executables that are used but not listed in package.json
  ignoreBinaries: [
    'only-allow', // Used in preinstall script to enforce pnpm usage
  ],

  // ============================================================================
  // Reporting Rules
  // ============================================================================
  // Configure what types of issues to report and at what severity level
  rules: {
    // ========================================================================
    // Unused files are ERRORS
    // ========================================================================
    // These should definitely be removed or used.
    // However, always manually verify before deleting!
    files: 'error',

    // ========================================================================
    // Unused dependencies are WARNINGS
    // ========================================================================
    // Dependencies might be:
    // - Used in production builds but not in dev
    // - Peer dependencies
    // - Used by other tools
    dependencies: 'warn',
    devDependencies: 'warn',

    // ========================================================================
    // Unlisted imports are ERRORS
    // ========================================================================
    // Missing from package.json - will break in production!
    unlisted: 'error',

    // ========================================================================
    // Unused exports are WARNINGS (not errors!)
    // ========================================================================
    // Exports might be:
    // - Part of public API for future use
    // - Used by external tools
    // - Exported for type inference
    // ⚠️ ALWAYS manually verify before removing exports!
    exports: 'warn',

    // Unused types are warnings (might be part of type definitions)
    types: 'warn',

    // Duplicate exports are warnings (could cause confusion but not breaking)
    duplicates: 'warn',
  },
}

export default config
