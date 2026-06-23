'use client'

export function SnippetCollapsedPreview({
  inputFieldCount,
}: {
  inputFieldCount: number
}) {
  return (
    <div
      className="flex min-h-0 grow flex-col items-center px-2 pt-4"
      aria-label="Snippet collapsed preview"
    >
      <div
        className="flex size-10 items-center justify-center rounded-[16px] border border-divider-subtle bg-background-default-subtle text-text-tertiary shadow-xs"
        aria-hidden="true"
      >
        <span className="relative block size-6">
          <span className="absolute top-1/2 left-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-util-colors-blue-blue-500" />
          <span className="absolute top-0 left-0 size-3 rounded-md bg-util-colors-blue-blue-300 shadow-xs" />
          <span className="absolute top-1/2 right-0 size-3 -translate-y-1/2 rounded-md bg-util-colors-blue-blue-600 shadow-xs" />
          <span className="absolute bottom-0 left-0 size-3 rounded-md bg-util-colors-indigo-indigo-400 shadow-xs" />
        </span>
      </div>
      <div className="my-2 h-0.5 w-8 rounded-full bg-divider-subtle" aria-hidden="true" />
      <div
        className="relative flex size-8 items-center justify-center rounded-[16px] border border-divider-subtle bg-background-default-subtle text-text-accent shadow-xs"
        aria-label={`${inputFieldCount} input fields`}
      >
        <span aria-hidden="true" className="i-custom-vender-solid-development-variable-02 size-5" />
        <span className="absolute -right-1.5 -bottom-1.5 flex size-5.5 items-center justify-center rounded-full border-2 border-components-panel-bg bg-state-accent-solid text-xs leading-none font-semibold text-text-primary-on-surface shadow-xs">
          {inputFieldCount}
        </span>
      </div>
    </div>
  )
}
