import type { ResearchTaskProgressEvent } from './services/research-task-events'

export function timeValue(value: number) {
  return value < 10_000_000_000 ? value * 1000 : value
}

export function mergeResearchProgressEvent(
  events: ResearchTaskProgressEvent[],
  event: ResearchTaskProgressEvent,
) {
  const next = events.filter((candidate) => candidate.sequence !== event.sequence)
  next.push(event)
  return next.sort((left, right) => left.sequence - right.sequence)
}
