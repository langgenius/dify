import type { ExternalAgentOverviewPreview, ExternalAgentSkillPreview } from '../preview'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

function AgentSkill({ skill }: { skill: ExternalAgentSkillPreview }) {
  const { t } = useTranslation(['agentRoster'])
  const startRef = useRef<HTMLSpanElement>(null)
  const [isStuck, setIsStuck] = useState(false)

  useEffect(() => {
    const start = startRef.current
    const root = start?.closest('[data-external-agent-overview-scroll]')
    if (!start || !root) return

    // Observe the section's natural start while CSS handles sticking and being pushed away.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.rootBounds) return
        setIsStuck(entry.boundingClientRect.top < entry.rootBounds.top)
      },
      { root, threshold: [0, 1] },
    )
    observer.observe(start)
    return () => observer.disconnect()
  }, [])

  return (
    <Collapsible defaultOpen className="relative px-4">
      <span ref={startRef} aria-hidden className="pointer-events-none absolute top-0 h-px w-px" />
      <h3
        data-stuck={isStuck || undefined}
        className="sticky top-0 z-10 -mx-4 border-b border-transparent bg-background-default px-4 py-2 data-stuck:border-divider-subtle"
      >
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-sm text-start system-md-semibold text-text-primary">
          <span className="min-w-0 wrap-break-word">{skill.name}</span>
          <span
            aria-hidden
            className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-tertiary group-data-panel-open:rotate-180"
          />
        </CollapsibleTrigger>
      </h3>
      <CollapsiblePanel>
        <div className="flex flex-col gap-3 pt-0.5 pb-3">
          <div className="space-y-1.5">
            <p className="system-sm-regular wrap-break-word text-text-tertiary">
              {skill.description}
            </p>
            <ul className="flex flex-wrap gap-1">
              {skill.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-[5px] border border-divider-deep px-1.25 py-0.75 system-2xs-medium text-text-tertiary"
                >
                  {tag}
                </li>
              ))}
            </ul>
          </div>
          {(skill.inputFormats || skill.outputFormats) && (
            <dl className="flex flex-wrap gap-x-6 gap-y-2 system-xs-regular">
              {skill.inputFormats && (
                <div className="flex gap-2">
                  <dt className="text-text-tertiary">
                    {t(($) => $['external.overview.inputFormats'])}
                  </dt>
                  <dd className="text-text-secondary">{skill.inputFormats.join(', ')}</dd>
                </div>
              )}
              {skill.outputFormats && (
                <div className="flex gap-2">
                  <dt className="text-text-tertiary">
                    {t(($) => $['external.overview.outputFormats'])}
                  </dt>
                  <dd className="text-text-secondary">{skill.outputFormats.join(', ')}</dd>
                </div>
              )}
            </dl>
          )}
          <Collapsible>
            <CollapsibleTrigger className="group flex w-fit items-center gap-1 rounded-sm system-xs-regular text-text-tertiary">
              {t(($) => $['external.overview.examples'])}
              <span
                aria-hidden
                className="i-ri-arrow-right-s-fill size-4 text-text-quaternary group-data-panel-open:rotate-90 rtl:-scale-x-100"
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <ul className="mt-2 space-y-1 rounded-lg bg-background-section p-3 system-sm-regular text-text-secondary">
                {skill.examples.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  )
}

export function ExternalAgentSkills({
  skills,
}: {
  skills: ExternalAgentOverviewPreview['skills']
}) {
  const { t } = useTranslation(['agentRoster'])
  return (
    <section>
      <h2 className="flex items-center gap-2 pb-2 body-lg-regular leading-6 font-medium text-text-secondary">
        {t(($) => $['external.overview.skills'])}
        <span className="system-sm-regular text-text-quaternary">{skills.length}</span>
      </h2>
      {skills.length === 0 ? (
        <p className="rounded-[10px] bg-background-section p-3 text-center system-xs-regular text-text-tertiary">
          {t(($) => $['external.overview.emptySkills'])}
        </p>
      ) : (
        <div className="divide-y divide-divider-subtle overflow-clip rounded-xl border border-divider-regular">
          {skills.map((skill) => (
            <AgentSkill key={skill.id} skill={skill} />
          ))}
        </div>
      )}
    </section>
  )
}
