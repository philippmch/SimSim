import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DASHBOARD_SECTION_IDS, DASHBOARD_SECTION_NAVIGATION, DASHBOARD_SECTION_SCROLL_OPTIONS, DashboardNavigation, openDashboardSection, type DashboardNavigationDocument, type DashboardNavigationTarget } from './DashboardNavigation'

interface TargetSpy extends DashboardNavigationTarget {
  scrollCalls: ScrollIntoViewOptions[]
  focusCalls: FocusOptions[]
}

function targetSpy(): TargetSpy {
  return {
    scrollCalls: [],
    focusCalls: [],
    scrollIntoView(options) { this.scrollCalls.push(options ?? {}) },
    focus(options) { this.focusCalls.push(options ?? {}) },
  }
}

describe('dashboard navigation markup', () => {
  it('renders four unique native controls mapped to stable section IDs', () => {
    const markup = renderToStaticMarkup(createElement(DashboardNavigation))

    expect(markup).toContain('<nav class="interventions" aria-label="Dashboard sections">')
    expect(markup).toContain('<span><strong>Explore results</strong><small>Jump to section</small></span>')
    expect(markup.match(/<button\b/g)).toHaveLength(4)
    expect(markup.match(/aria-controls="[^"]+"/g)).toEqual([
      `aria-controls="${DASHBOARD_SECTION_IDS.liveOverview}"`,
      `aria-controls="${DASHBOARD_SECTION_IDS.generationJournal}"`,
      `aria-controls="${DASHBOARD_SECTION_IDS.populationLineages}"`,
      `aria-controls="${DASHBOARD_SECTION_IDS.insightsCharts}"`,
    ])
    expect(markup).toContain('>Live overview</button>')
    expect(markup).toContain('>Generation journal</button>')
    expect(markup).toContain('>Population &amp; lineages</button>')
    expect(markup).toContain('>Insights &amp; charts</button>')
    expect(new Set(DASHBOARD_SECTION_NAVIGATION.map(item => item.id)).size).toBe(4)
    expect(new Set(DASHBOARD_SECTION_NAVIGATION.map(item => item.label)).size).toBe(4)
  })
})

describe('openDashboardSection', () => {
  it('scrolls the stable target and focuses a freshly queried replacement', () => {
    const first = targetSpy()
    const replacement = targetSpy()
    const lookups: string[] = []
    let lookupCount = 0
    const documentRef: DashboardNavigationDocument = {
      getElementById(id) {
        lookups.push(id)
        lookupCount += 1
        return lookupCount === 1 ? first : replacement
      },
    }
    const scheduled: (() => void)[] = []

    expect(openDashboardSection(DASHBOARD_SECTION_IDS.populationLineages, {
      document: documentRef,
      scheduleFocus: callback => scheduled.push(callback),
    })).toBe(true)
    expect(first.scrollCalls).toEqual([DASHBOARD_SECTION_SCROLL_OPTIONS])
    expect(first.focusCalls).toEqual([])
    expect(lookups).toEqual([DASHBOARD_SECTION_IDS.populationLineages])
    expect(scheduled).toHaveLength(1)

    scheduled[0]()
    expect(lookups).toEqual([DASHBOARD_SECTION_IDS.populationLineages, DASHBOARD_SECTION_IDS.populationLineages])
    expect(replacement.focusCalls).toEqual([{ preventScroll: true }])
  })

  it('returns false and does not schedule focus when the target is absent', () => {
    const scheduled = { calls: 0 }
    const documentRef: DashboardNavigationDocument = { getElementById: () => null }

    expect(openDashboardSection(DASHBOARD_SECTION_IDS.insightsCharts, {
      document: documentRef,
      scheduleFocus: () => { scheduled.calls += 1 },
    })).toBe(false)
    expect(scheduled.calls).toBe(0)
  })

  it('is safe to call without a browser document during SSR', () => {
    expect(() => openDashboardSection(DASHBOARD_SECTION_IDS.liveOverview)).not.toThrow()
  })
})
