type TreeBranchLineProps = {
  last?: boolean
}

export default function TreeBranchLine({ last = false }: TreeBranchLineProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 40"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-s-0 top-0 h-full w-6 overflow-visible text-divider-deep rtl:-scale-x-100"
    >
      <path
        d={last ? 'M0 0 V8 C0 14.6 5.4 20 12 20 H12' : 'M0 0 V40 M0 8 C0 14.6 5.4 20 12 20 H12'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
