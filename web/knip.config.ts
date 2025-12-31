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

      // Linting configuration
      'eslint.config.mjs',
    ],
  },

  // ============================================================================
  // Global Entry Points
  // ============================================================================
  // Files that serve as entry points for the application.
  // The '!' suffix means these patterns take precedence and are always included.
  // Note: Next.js plugin automatically handles page.tsx, layout.tsx, loading.tsx,
  // middleware.ts, next.config.js, and other standard Next.js files.
  entry: [
    // ========================================================================
    // 🔒 CRITICAL: Global Initializers and Providers
    // ========================================================================
    // These files are imported by root layout.tsx and provide global functionality.
    // Even if not directly imported elsewhere, they are essential for app initialization.

    // Browser initialization (runs on client startup)
    'app/components/browser-initializer.tsx!',
    'app/components/sentry-initializer.tsx!',
    'app/components/app-initializer.tsx!',

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

    // ========================================================================
    // Development tools
    // ========================================================================
    // Storybook configuration
    '.storybook/**/*',

    // ========================================================================
    // Utility scripts (not part of application runtime)
    // ========================================================================
    'scripts/**/*.{js,ts,mjs}',
    'bin/**/*.{js,ts,mjs}',
    'i18n-config/**/*.{js,ts,mjs}',
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
    files: 'warn',
    dependencies: 'warn',
    devDependencies: 'warn',
    optionalPeerDependencies: 'warn',
    unlisted: 'warn',
    unresolved: 'warn',
    exports: 'warn',
    nsExports: 'warn',
    classMembers: 'warn',
    types: 'warn',
    nsTypes: 'warn',
    enumMembers: 'warn',
    duplicates: 'warn',
  },
}

export default config
