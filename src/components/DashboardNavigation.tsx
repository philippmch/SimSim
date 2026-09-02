import type { CSSProperties } from 'react'

/** Stable targets shared by the in-flow dashboard navigator and its sections. */
export const DASHBOARD_SECTION_IDS = {
  liveOverview: 'live-overview',
  generationJournal: 'generation-journal',
  populationLineages: 'population-lineages',
  insightsCharts: 'insights-charts',
} as const

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[keyof typeof DASHBOARD_SECTION_IDS]

export interface DashboardSectionNavigationItem {
  id: DashboardSectionId
  label: string
}

export const DASHBOARD_SECTION_NAVIGATION: readonly DashboardSectionNavigationItem[] = [
  { id: DASHBOARD_SECTION_IDS.liveOverview, label: 'Live overview' },
  { id: DASHBOARD_SECTION_IDS.generationJournal, label: 'Generation journal' },
  { id: DASHBOARD_SECTION_IDS.populationLineages, label: 'Population & lineages' },
  { id: DASHBOARD_SECTION_IDS.insightsCharts, label: 'Insights & charts' },
]

/** Keep section headings below the sticky header while preserving native scroll behavior. */
export const DASHBOARD_SECTION_SCROLL_OPTIONS: ScrollIntoViewOptions = {
  behavior: 'auto',
  block: 'start',
  inline: 'nearest',
}

export const DASHBOARD_SECTION_SCROLL_STYLE: CSSProperties = { scrollMarginTop: '84px' }

export interface DashboardNavigationTarget {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void
  focus: (options?: FocusOptions) => void
}

export interface DashboardNavigationDocument {
  getElementById: (id: string) => DashboardNavigationTarget | null
}

export interface DashboardSectionNavigationOptions {
  /** Injected for deterministic tests and for callers that render outside a browser. */
  document?: DashboardNavigationDocument
  /** Injected scheduler; production defaults to the next animation frame. */
  scheduleFocus?: (callback: () => void) => void
}

const scheduleDashboardSectionFocus = (callback: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => callback())
  else setTimeout(callback, 0)
}

/**
 * Move to a stable dashboard section only after an explicit user request.
 *
 * The target is looked up again before focus so that a lazy child may mount or
 * replace its contents without ever becoming the focus destination itself.
 */
export function openDashboardSection(sectionId: DashboardSectionId, options: DashboardSectionNavigationOptions = {}): boolean {
  const documentRef: DashboardNavigationDocument | null = options.document
    ?? (typeof document === 'undefined' ? null : document as unknown as DashboardNavigationDocument)
  if (!documentRef) return false

  const target = documentRef.getElementById(sectionId)
  if (!target) return false

  target.scrollIntoView(DASHBOARD_SECTION_SCROLL_OPTIONS)
  const scheduleFocus = options.scheduleFocus ?? scheduleDashboardSectionFocus
  scheduleFocus(() => {
    const currentTarget = documentRef.getElementById(sectionId)
    if (currentTarget) currentTarget.focus({ preventScroll: true })
  })
  return true
}

export interface DashboardNavigationProps {
  onNavigate?: (sectionId: DashboardSectionId) => void | boolean
}

const defaultDashboardNavigation = (sectionId: DashboardSectionId): boolean => openDashboardSection(sectionId)

export function DashboardNavigation({ onNavigate = defaultDashboardNavigation }: DashboardNavigationProps) {
  return <nav className="interventions" aria-label="Dashboard sections">
    <span><strong>Explore results</strong><small>Jump to section</small></span>
    {DASHBOARD_SECTION_NAVIGATION.map(item => <button key={item.id} type="button" aria-controls={item.id} onClick={() => onNavigate(item.id)}>{item.label}</button>)}
  </nav>
}

export default DashboardNavigation
