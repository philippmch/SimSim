import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { DASHBOARD_SECTION_IDS, DASHBOARD_SECTION_NAVIGATION } from './components/DashboardNavigation'

describe('dashboard section navigation integration', () => {
  it('wires every control to one stable focusable section outside lazy content', () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => null },
      matchMedia: () => ({ matches: false }),
    })

    try {
      const markup = renderToStaticMarkup(createElement(App))

      for (const { id } of DASHBOARD_SECTION_NAVIGATION) {
        expect(markup.match(new RegExp(`aria-controls="${id}"`, 'g'))).toHaveLength(1)
        expect(markup.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1)
        expect(markup).toMatch(new RegExp(`<section id="${id}" tabindex="-1"[^>]*scroll-margin-top:84px`))
      }
      expect(markup).toContain(`id="${DASHBOARD_SECTION_IDS.generationJournal}"`)
      expect(markup).not.toContain('<section class="evolution-story"')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
