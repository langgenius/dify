import type { ComponentType } from 'react'
import {
  derived,
  figures,
  formatDate,
  formatInt,
  formatPercent,
  PERIOD,
  releaseRange,
  releases,
} from './figures'
import {
  DifyLogo,
  DotField,
  Eyebrow,
  Headline,
  HeroFigure,
  Lede,
  Legend,
  ReleaseTimeline,
  Ring,
  SegmentMeter,
  SlideFrame,
  stagger,
  StatTile,
  Waffle,
} from './parts'

/** One row of a slide's table view: the same figure the slide draws, as text. */
export type Figure = {
  label: string
  value: string
  note?: string
}

export type Slide = {
  id: string
  section: string
  name: string
  component: ComponentType
  figures: Figure[]
}

const SOURCE_ENGINEERING = 'Dify engineering, March – August 2026'
const SOURCE_GITHUB = 'GitHub releases, langgenius/dify'

function CoverSlide() {
  return (
    <SlideFrame glow className="justify-between">
      <Eyebrow step={0}>Dify · Launch event · September 2026</Eyebrow>
      <div>
        <div className="deck-rise" style={stagger(1)}>
          <DifyLogo className="h-[116px] w-auto text-text-primary" />
        </div>
        <h1
          className="deck-rise mt-14 max-w-[1500px] text-[136px] leading-[1] font-semibold tracking-[-0.04em] text-balance text-text-primary"
          style={stagger(2)}
        >
          Six months in the open.
        </h1>
        <Lede step={3} className="mt-10 max-w-[1180px]">
          What we shipped, who shipped it with us, and what it takes to keep Dify running in
          production. {PERIOD.label}.
        </Lede>
      </div>
    </SlideFrame>
  )
}

function ShippingSlide() {
  return (
    <SlideFrame>
      <Eyebrow step={0}>Shipping</Eyebrow>
      <Headline step={1}>A release every {derived.daysPerRelease} days.</Headline>
      <div className="mt-[64px] grid grid-cols-3 gap-10">
        <StatTile step={2} label="Product improvements" value={figures.improvements} />
        <StatTile
          step={3}
          label="Commits to main"
          value={figures.commits}
          note={`${formatInt(derived.commitsPerRelease)} per release`}
        />
        <StatTile
          step={4}
          label="Stable releases"
          value={figures.releases}
          note={`v${releaseRange.first} → v${releaseRange.last}`}
        />
      </div>
      <div className="mt-auto">
        <ReleaseTimeline step={5} />
        <p className="deck-rise mt-2 text-[20px] text-text-tertiary" style={stagger(6)}>
          Stable releases on GitHub, {PERIOD.label}. Hover a release for its date.
        </p>
      </div>
    </SlideFrame>
  )
}

function CoCreatedSlide() {
  return (
    <SlideFrame>
      <div className="flex h-full items-center gap-[80px]">
        <div className="flex min-w-0 flex-1 flex-col">
          <Eyebrow step={0}>Community</Eyebrow>
          <Headline step={1} className="max-w-[860px]">
            {formatInt(figures.coCreated)} of the {formatInt(figures.improvements)} improvements
            were co-created with the community.
          </Headline>
          <div className="mt-[56px]">
            <HeroFigure
              step={2}
              value={figures.coCreatedShare}
              decimals={2}
              suffix="%"
              label="of all product improvements this period"
            />
          </div>
          <div className="mt-[48px]">
            <Legend
              step={3}
              items={[
                {
                  label: 'Co-created with the community',
                  value: formatInt(figures.coCreated),
                  tone: 'accent',
                },
                { label: 'Core team', value: formatInt(derived.improvementsByCore), tone: 'rest' },
              ]}
            />
          </div>
          <p className="deck-rise mt-8 text-[20px] text-text-tertiary" style={stagger(4)}>
            One square, one improvement.
          </p>
        </div>
        <Waffle
          total={figures.improvements}
          filled={figures.coCreated}
          columns={16}
          cell={34}
          gap={10}
          label={`${figures.coCreated} of ${figures.improvements} improvements co-created with the community`}
          className="shrink-0"
        />
      </div>
    </SlideFrame>
  )
}

function MergedSlide() {
  return (
    <SlideFrame>
      <Eyebrow step={0}>Community</Eyebrow>
      <Headline step={1}>{formatInt(figures.prsMerged)} pull requests merged.</Headline>
      <div className="mt-[56px] flex items-start gap-[88px]">
        <DotField
          count={figures.prsMerged}
          columns={50}
          cell={14}
          gap={8}
          label={`${formatInt(figures.prsMerged)} merged community pull requests, one dot each`}
          className="shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-10">
          <StatTile
            step={2}
            size="md"
            label="Lines of community code"
            value={figures.communityLines}
          />
          <StatTile
            step={3}
            size="md"
            label="Merged per day, on average"
            value={derived.prsPerDay}
            decimals={1}
          />
          <StatTile
            step={4}
            size="md"
            label="Lines per pull request, on average"
            value={derived.linesPerPr}
          />
        </div>
      </div>
      <p className="deck-rise mt-auto text-[20px] text-text-tertiary" style={stagger(5)}>
        One dot, one merged pull request.
      </p>
    </SlideFrame>
  )
}

function EveryReleaseSlide() {
  return (
    <SlideFrame>
      <Eyebrow step={0}>Community</Eyebrow>
      <Headline step={1} className="max-w-[1400px]">
        {figures.releasesWithCommunity} of {figures.releases} releases shipped with
        community-authored changes.
      </Headline>
      <div className="mt-[72px]">
        <SegmentMeter
          step={2}
          value={figures.releasesWithCommunity}
          max={figures.releases}
          label={`${figures.releasesWithCommunity} of ${figures.releases} stable releases shipped community-authored changes`}
        />
        <div className="mt-8 flex items-end justify-between">
          <Legend
            step={3}
            items={[
              {
                label: 'Shipped community-authored changes',
                value: formatInt(figures.releasesWithCommunity),
                tone: 'accent',
              },
              {
                label: 'Core team only',
                value: formatInt(figures.releases - figures.releasesWithCommunity),
                tone: 'track',
              },
            ]}
          />
          <p className="deck-rise text-[22px] text-text-tertiary tabular-nums" style={stagger(3)}>
            {figures.releasesWithCommunity} / {figures.releases} ·{' '}
            {Math.round((figures.releasesWithCommunity / figures.releases) * 100)}%
          </p>
        </div>
        <p className="deck-rise mt-6 text-[20px] text-text-tertiary" style={stagger(4)}>
          One block, one stable release.
        </p>
      </div>
      <Lede step={5} className="mt-auto max-w-[1320px]">
        Meanwhile, a different trend is spreading on GitHub: repositories closing their pull
        requests. Source-available, for show. Not collaboration.
      </Lede>
    </SlideFrame>
  )
}

function ButWeDontSlide() {
  return (
    <SlideFrame glow className="justify-center">
      <h2
        className="deck-rise text-[216px] leading-none font-semibold tracking-[-0.05em] text-text-primary"
        style={stagger(0)}
      >
        But we don&rsquo;t<span className="text-text-accent">.</span>
      </h2>
      <Lede step={1} className="mt-12 max-w-[1240px] text-[36px]">
        Dify stays open to contribution. Every one of those {formatInt(figures.prsMerged)} pull
        requests came in through the front door: reviewed, merged, released.
      </Lede>
      <p
        className="deck-rise mt-16 flex items-center gap-4 text-[24px] text-text-tertiary"
        style={stagger(2)}
      >
        <span aria-hidden className="i-ri-github-fill size-8" />
        github.com/langgenius/dify · Pull requests welcome
      </p>
    </SlideFrame>
  )
}

function ProductionSlide() {
  return (
    <SlideFrame glow className="justify-center">
      <Eyebrow step={0}>Production</Eyebrow>
      <h2
        className="deck-rise mt-8 max-w-[1500px] text-[152px] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-text-primary"
        style={stagger(1)}
      >
        Production is a promise.
      </h2>
      <Lede step={2} className="mt-12 max-w-[1240px] text-[36px]">
        Teams run real workloads on Dify, every day. Keeping it fast, reliable and secure is not a
        feature. It is our duty.
      </Lede>
    </SlideFrame>
  )
}

function RuntimeSlide() {
  return (
    <SlideFrame>
      <div className="flex h-full items-center gap-[80px]">
        <div className="flex min-w-0 flex-1 flex-col">
          <Eyebrow step={0}>Production</Eyebrow>
          <Headline step={1} className="max-w-[960px]">
            {figures.runtimeImprovements} improvements to how Dify runs. {figures.runtimeHardening}{' '}
            of them on performance, reliability and security.
          </Headline>
          <div className="mt-[56px]">
            <HeroFigure
              step={2}
              value={figures.runtimeHardeningShare}
              decimals={2}
              suffix="%"
              label="of runtime improvements went beyond experience"
            />
          </div>
          <div className="mt-[48px]">
            <Legend
              step={3}
              items={[
                {
                  label: 'Performance · Reliability · Security',
                  value: formatInt(figures.runtimeHardening),
                  tone: 'accent',
                },
                { label: 'Experience', value: formatInt(derived.runtimeExperience), tone: 'rest' },
              ]}
            />
          </div>
        </div>
        <Waffle
          total={figures.runtimeImprovements}
          filled={figures.runtimeHardening}
          columns={9}
          cell={48}
          gap={12}
          label={`${figures.runtimeHardening} of ${figures.runtimeImprovements} runtime improvements on performance, reliability and security`}
          className="shrink-0"
        />
      </div>
    </SlideFrame>
  )
}

function TestsSlide() {
  return (
    <SlideFrame>
      <div className="flex h-full items-center gap-[96px]">
        <div className="flex min-w-0 flex-1 flex-col">
          <Eyebrow step={0}>Production</Eyebrow>
          <Headline step={1}>Tested, line by line.</Headline>
          <div className="mt-[48px]">
            <HeroFigure
              step={2}
              value={figures.testLines}
              label="lines of test code added to the main product"
            />
          </div>
          <Lede step={3} className="mt-[56px] max-w-[980px]">
            This is our duty: production stays secured because it stays tested.
          </Lede>
        </div>
        <Ring
          step={2}
          share={figures.communityTestShare}
          label={`${formatPercent(figures.communityTestShare)} of the test code was written by the community`}
        >
          <p className="text-[88px] leading-none font-semibold tracking-[-0.04em] text-text-primary">
            {formatPercent(figures.communityTestShare)}
          </p>
          <p className="mt-3 max-w-[260px] text-[22px] leading-snug text-text-secondary">
            written by the community
          </p>
          <p className="mt-2 text-[20px] text-text-tertiary tabular-nums">
            {formatInt(figures.communityTestLines)} lines
          </p>
        </Ring>
      </div>
    </SlideFrame>
  )
}

const recapTiles = [
  { label: 'Product improvements', value: figures.improvements },
  {
    label: 'Commits to main',
    value: figures.commits,
    note: `${formatInt(derived.commitsPerRelease)} per release`,
  },
  {
    label: 'Stable releases',
    value: figures.releases,
    note: `one every ${derived.daysPerRelease} days`,
  },
  {
    label: 'Co-created with the community',
    value: figures.coCreatedShare,
    decimals: 2,
    suffix: '%',
    note: `${formatInt(figures.coCreated)} of ${formatInt(figures.improvements)} improvements`,
  },
  { label: 'Community pull requests merged', value: figures.prsMerged },
  { label: 'Lines of community code', value: figures.communityLines },
  {
    label: 'Runtime work on performance, reliability, security',
    value: figures.runtimeHardeningShare,
    decimals: 2,
    suffix: '%',
    note: `${formatInt(figures.runtimeHardening)} of ${formatInt(figures.runtimeImprovements)} improvements`,
  },
  {
    label: 'Lines of test code added',
    value: figures.testLines,
    note: `${formatInt(figures.communityTestLines)} by the community`,
  },
]

function RecapSlide() {
  return (
    <SlideFrame>
      <Eyebrow step={0}>Recap</Eyebrow>
      <Headline step={1}>Six months, by the numbers.</Headline>
      <div className="mt-[72px] grid grid-cols-4 gap-x-10 gap-y-[80px]">
        {recapTiles.map((tile, index) => (
          <StatTile
            key={tile.label}
            step={2 + index}
            size="sm"
            label={tile.label}
            value={tile.value}
            decimals={tile.decimals}
            suffix={tile.suffix}
            note={tile.note}
          />
        ))}
      </div>
    </SlideFrame>
  )
}

function ClosingSlide() {
  return (
    <SlideFrame glow className="justify-between">
      <div className="mt-auto">
        <h2
          className="deck-rise text-[216px] leading-none font-semibold tracking-[-0.05em] text-text-primary"
          style={stagger(0)}
        >
          Still open<span className="text-text-accent">.</span>
        </h2>
        <Lede step={1} className="mt-12 max-w-[1240px] text-[36px]">
          Thank you to everyone behind those {formatInt(figures.prsMerged)} pull requests, and to
          everyone running Dify in production.
        </Lede>
      </div>
      <div className="deck-rise mt-auto flex items-end justify-between" style={stagger(2)}>
        <DifyLogo className="h-[56px] w-auto text-text-primary" />
        <p className="flex items-center gap-4 text-[24px] text-text-tertiary">
          <span aria-hidden className="i-ri-github-fill size-8" />
          github.com/langgenius/dify
        </p>
      </div>
    </SlideFrame>
  )
}

export const slides: Slide[] = [
  {
    id: 'cover',
    section: 'Opening',
    name: 'Six months in the open',
    component: CoverSlide,
    figures: [{ label: 'Period covered', value: PERIOD.label }],
  },
  {
    id: 'shipping',
    section: 'Shipping',
    name: 'A release every 18 days',
    component: ShippingSlide,
    figures: [
      {
        label: 'Product improvements',
        value: formatInt(figures.improvements),
        note: SOURCE_ENGINEERING,
      },
      { label: 'Commits to main', value: formatInt(figures.commits), note: SOURCE_ENGINEERING },
      {
        label: 'Commits per release, on average',
        value: formatInt(derived.commitsPerRelease),
        note: `${formatInt(figures.commits)} ÷ ${figures.releases}`,
      },
      { label: 'Stable releases', value: formatInt(figures.releases), note: SOURCE_GITHUB },
      {
        label: 'Days per release, on average',
        value: formatInt(derived.daysPerRelease),
        note: `${PERIOD.days} days ÷ ${figures.releases} releases`,
      },
      ...releases.map((release) => ({
        label: `v${release.tag}`,
        value: formatDate(release.date),
        note: SOURCE_GITHUB,
      })),
    ],
  },
  {
    id: 'co-created',
    section: 'Community',
    name: 'Co-created with the community',
    component: CoCreatedSlide,
    figures: [
      {
        label: 'Improvements co-created with the community',
        value: formatInt(figures.coCreated),
        note: SOURCE_ENGINEERING,
      },
      {
        label: 'Improvements by the core team',
        value: formatInt(derived.improvementsByCore),
        note: `${formatInt(figures.improvements)} − ${formatInt(figures.coCreated)}`,
      },
      {
        label: 'Share co-created',
        value: formatPercent(figures.coCreatedShare),
        note: `${formatInt(figures.coCreated)} ÷ ${formatInt(figures.improvements)}`,
      },
    ],
  },
  {
    id: 'merged',
    section: 'Community',
    name: 'Pull requests merged',
    component: MergedSlide,
    figures: [
      {
        label: 'Community pull requests merged',
        value: formatInt(figures.prsMerged),
        note: SOURCE_ENGINEERING,
      },
      {
        label: 'Lines of community code',
        value: formatInt(figures.communityLines),
        note: SOURCE_ENGINEERING,
      },
      {
        label: 'Merged per day, on average',
        value: formatPercent(derived.prsPerDay).replace('%', ''),
        note: `${formatInt(figures.prsMerged)} ÷ ${PERIOD.days} days`,
      },
      {
        label: 'Lines per pull request, on average',
        value: formatInt(derived.linesPerPr),
        note: `${formatInt(figures.communityLines)} ÷ ${formatInt(figures.prsMerged)}`,
      },
    ],
  },
  {
    id: 'every-release',
    section: 'Community',
    name: 'Every release, together',
    component: EveryReleaseSlide,
    figures: [
      {
        label: 'Stable releases with community-authored changes',
        value: `${figures.releasesWithCommunity} of ${figures.releases}`,
        note: SOURCE_ENGINEERING,
      },
    ],
  },
  {
    id: 'but-we-dont',
    section: 'Community',
    name: 'But we don’t',
    component: ButWeDontSlide,
    figures: [
      {
        label: 'Community pull requests merged',
        value: formatInt(figures.prsMerged),
        note: SOURCE_ENGINEERING,
      },
    ],
  },
  {
    id: 'production',
    section: 'Production',
    name: 'Production is a promise',
    component: ProductionSlide,
    figures: [],
  },
  {
    id: 'runtime',
    section: 'Production',
    name: 'How Dify runs',
    component: RuntimeSlide,
    figures: [
      {
        label: 'Improvements to how Dify runs',
        value: formatInt(figures.runtimeImprovements),
        note: SOURCE_ENGINEERING,
      },
      {
        label: 'On performance, reliability and security',
        value: formatInt(figures.runtimeHardening),
        note: SOURCE_ENGINEERING,
      },
      {
        label: 'On experience',
        value: formatInt(derived.runtimeExperience),
        note: `${figures.runtimeImprovements} − ${figures.runtimeHardening}`,
      },
      {
        label: 'Share beyond experience',
        value: formatPercent(figures.runtimeHardeningShare),
        note: `${figures.runtimeHardening} ÷ ${figures.runtimeImprovements}`,
      },
    ],
  },
  {
    id: 'tests',
    section: 'Production',
    name: 'Tested, line by line',
    component: TestsSlide,
    figures: [
      {
        label: 'Lines of test code added',
        value: formatInt(figures.testLines),
        note: SOURCE_ENGINEERING,
      },
      {
        label: 'Written by the community',
        value: formatInt(figures.communityTestLines),
        note: SOURCE_ENGINEERING,
      },
      {
        label: 'Written by the core team',
        value: formatInt(derived.coreTestLines),
        note: `${formatInt(figures.testLines)} − ${formatInt(figures.communityTestLines)}`,
      },
      {
        label: 'Community share',
        value: formatPercent(figures.communityTestShare),
        note: `${formatInt(figures.communityTestLines)} ÷ ${formatInt(figures.testLines)}`,
      },
    ],
  },
  {
    id: 'recap',
    section: 'Recap',
    name: 'Six months, by the numbers',
    component: RecapSlide,
    figures: recapTiles.map((tile) => ({
      label: tile.label,
      value: `${tile.value.toLocaleString('en-US', {
        minimumFractionDigits: tile.decimals ?? 0,
        maximumFractionDigits: tile.decimals ?? 0,
      })}${tile.suffix ?? ''}`,
      note: tile.note,
    })),
  },
  {
    id: 'closing',
    section: 'Closing',
    name: 'Still open',
    component: ClosingSlide,
    figures: [],
  },
]
