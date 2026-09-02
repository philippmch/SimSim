import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GenerationLedger } from '../simulation/types'
import { deriveJournalMaturity } from './GenerationJournal'
import { formatSettlementAnnouncement, formatSettlementBirthCap, formatSettlementEquation, formatSettlementLosses, formatSettlementMaturityBreakdown, formatSettlementReportAriaLabel, getSettlementGeneration, isFiniteNonnegativeInteger, isValidSettlementNextGeneration, SETTLEMENT_MATURITY_UNAVAILABLE, SETTLEMENT_REPORT_UNAVAILABLE, SettlementReport, summarizeLatestSettlement, summarizeSettlementReport } from './SettlementReport'

const makeLedger = (overrides: Record<string, unknown> = {}): GenerationLedger => ({
  generation: 4,
  startPopulation: 10,
  outcomes: { survived: 5, hunted: 1, energy: 1, unfed: 1, late: 1, aged: 1 },
  birthsEligible: 3,
  birthsAdmitted: 2,
  birthsCapped: 1,
  ...overrides,
} as unknown as GenerationLedger)

describe('settlement report helpers', () => {
  it('validates finite, safe, nonnegative integer counts', () => {
    for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) expect(isFiniteNonnegativeInteger(value)).toBe(true)
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2', null]) expect(isFiniteNonnegativeInteger(value)).toBe(false)
  })

  it('uses the newest retained ledger rather than the compatibility lastReport', () => {
    const summary = summarizeLatestSettlement([
      makeLedger({ generation: 3, startPopulation: 8, outcomes: { survived: 8, hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 }, birthsEligible: 0, birthsAdmitted: 0, birthsCapped: 0 }),
      makeLedger({ generation: 9, startPopulation: 10, outcomes: { survived: 5, hunted: 1, energy: 1, unfed: 1, late: 1, aged: 1 }, birthsEligible: 3, birthsAdmitted: 2, birthsCapped: 1 }),
    ])!

    expect(summary).toMatchObject({ generation: 9, nextGeneration: 10, evaluatedCohort: 10, survivors: 5, admittedBirths: 2, exactNextPopulation: 7, totalLosses: 5, cappedBirths: 1 })
    expect(formatSettlementEquation(summary)).toBe('10 creatures evaluated → 5 survived + 2 admitted births = 7 creatures in the next population')
  })

  it('renders a valid zero-loss, zero-birth settlement with an explicit zero cap', () => {
    const summary = summarizeSettlementReport(makeLedger({ generation: 2, startPopulation: 4, outcomes: { survived: 4, hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 }, birthsEligible: 0, birthsAdmitted: 0, birthsCapped: 0 }))!

    expect(summary).toMatchObject({ evaluatedCohort: 4, survivors: 4, admittedBirths: 0, exactNextPopulation: 4, totalLosses: 0, cappedBirths: 0 })
    expect(formatSettlementLosses(summary)).toBe('Total losses: 0 · No recorded losses')
    expect(formatSettlementBirthCap(summary)).toBe('No births capped')
    const markup = renderToStaticMarkup(createElement(SettlementReport, { ledgers: [makeLedger({ generation: 2, startPopulation: 4, outcomes: { survived: 4, hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 }, birthsEligible: 0, birthsAdmitted: 0, birthsCapped: 0 })], onReviewGeneration: () => {} }))
    expect(markup).toContain('Capped births <b>0</b>')
  })

  it('keeps every nonzero loss cause in the recorded result', () => {
    const summary = summarizeSettlementReport(makeLedger())!

    expect(summary.losses).toEqual({ hunted: 1, energy: 1, unfed: 1, late: 1, aged: 1 })
    expect(summary.totalLosses).toBe(5)
    expect(formatSettlementLosses(summary)).toBe('Total losses: 5 · Hunted: 1 · Energy depleted: 1 · No food at settlement: 1 · Missed return deadline: 1 · Old age: 1')
  })

  it('reports nonzero births capped by the population limit', () => {
    const summary = summarizeSettlementReport(makeLedger({ birthsEligible: 5, birthsCapped: 3 }))!

    expect(summary.cappedBirths).toBe(3)
    expect(formatSettlementBirthCap(summary)).toBe('3 births capped by population limit')
    expect(formatSettlementAnnouncement(summary)).toContain('3 births capped by population limit')
  })

  it('reconciles an available maturity funnel with truthful singular and plural labels', () => {
    const ledger = makeLedger({ birthsEligible: 3, birthsAdmitted: 2, birthsCapped: 1, birthsImmature: 1 })
    const plural = summarizeSettlementReport(ledger)!
    expect(plural.maturity).toEqual({ matureEligible: 3, energyReadyImmature: 1, belowThreshold: 1 })
    expect(plural.maturity && { energyReadyImmature: plural.maturity.energyReadyImmature, belowThreshold: plural.maturity.belowThreshold }).toEqual(deriveJournalMaturity(ledger))
    expect(formatSettlementMaturityBreakdown(plural)).toBe('Reproduction: 3 mature + energy-eligible parents · 1 energy-ready but immature survivor · 1 survivor below reproduction threshold · 2 admitted births · 1 capacity-capped birth')
    expect(formatSettlementAnnouncement(plural)).toContain('1 energy-ready but immature survivor')

    const singular = summarizeSettlementReport(makeLedger({ startPopulation: 1, outcomes: { survived: 1, hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 }, birthsEligible: 1, birthsAdmitted: 1, birthsCapped: 0, birthsImmature: 0 }))!
    expect(singular.maturity).toEqual({ matureEligible: 1, energyReadyImmature: 0, belowThreshold: 0 })
    expect(formatSettlementMaturityBreakdown(singular)).toBe('Reproduction: 1 mature + energy-eligible parent · 0 energy-ready but immature survivors · 0 survivors below reproduction threshold · 1 admitted birth · 0 capacity-capped births')
    expect(formatSettlementAnnouncement(singular)).not.toContain('Maturity breakdown')
  })

  it('keeps missing, malformed, and inconsistent maturity telemetry unavailable', () => {
    const legacy = summarizeSettlementReport(makeLedger())!
    expect(legacy.maturity).toBeNull()
    expect(formatSettlementMaturityBreakdown(legacy)).toBe(SETTLEMENT_MATURITY_UNAVAILABLE)
    expect(formatSettlementAnnouncement(legacy)).not.toContain(SETTLEMENT_MATURITY_UNAVAILABLE)

    for (const birthsImmature of [null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      const malformed = summarizeSettlementReport(makeLedger({ birthsImmature }))!
      expect(malformed.maturity).toBeNull()
      expect(formatSettlementMaturityBreakdown(malformed)).toBe(SETTLEMENT_MATURITY_UNAVAILABLE)
    }
    for (const overrides of [
      { birthsEligible: 5, birthsAdmitted: 2, birthsCapped: 3, birthsImmature: 1 },
      { birthsEligible: 3, birthsAdmitted: 2, birthsCapped: 1, birthsImmature: 3 },
      { birthsEligible: 3, birthsAdmitted: 2, birthsCapped: 0, birthsImmature: 1 },
    ]) {
      const inconsistent = summarizeSettlementReport(makeLedger(overrides))!
      expect(inconsistent.maturity).toBeNull()
      expect(formatSettlementMaturityBreakdown(inconsistent)).toBe(SETTLEMENT_MATURITY_UNAVAILABLE)
    }
  })

  it('shows the maturity funnel in the compact result only once and announces nonzero detail', () => {
    const ledger = makeLedger({ birthsEligible: 3, birthsAdmitted: 2, birthsCapped: 1, birthsImmature: 1 })
    const markup = renderToStaticMarkup(createElement(SettlementReport, { ledgers: [ledger], onReviewGeneration: () => {} }))
    expect(markup).toContain('Reproduction: 3 mature + energy-eligible parents')
    expect(markup).not.toContain('Admitted births <b>2</b>')
    expect(markup).not.toContain('Capped births <b>1</b>')
    expect(markup).toContain('1 energy-ready but immature survivor')

    const legacyMarkup = renderToStaticMarkup(createElement(SettlementReport, { ledgers: [makeLedger()], onReviewGeneration: () => {} }))
    expect(legacyMarkup).not.toContain('Reproduction:')
    expect(legacyMarkup).toContain('Admitted births <b>2</b>')
    expect(legacyMarkup).toContain('Capped births <b>1</b>')
  })

  it('marks malformed required core fields unavailable without unsafe output', () => {
    for (const malformed of [
      makeLedger({ generation: Number.NaN }),
      makeLedger({ startPopulation: -1 }),
      makeLedger({ outcomes: { survived: Number.POSITIVE_INFINITY } }),
      makeLedger({ outcomes: { survived: 11 } }),
      makeLedger({ birthsAdmitted: 1.5 }),
    ]) {
      expect(summarizeSettlementReport(malformed)).toBeNull()
    }

    const markup = renderToStaticMarkup(createElement(SettlementReport, { ledgers: [makeLedger({ generation: Number.NaN })], onReviewGeneration: () => {} }))
    expect(markup).toContain(SETTLEMENT_REPORT_UNAVAILABLE)
    expect(markup).not.toContain('Review generation')
    expect(markup).not.toMatch(/NaN|Infinity|-1/)
  })

  it('keeps the newest retained record authoritative when its core is malformed', () => {
    const valid = makeLedger({ generation: 6, startPopulation: 4, outcomes: { survived: 3, hunted: 1, energy: 0, unfed: 0, late: 0, aged: 0 }, birthsEligible: 1, birthsAdmitted: 1, birthsCapped: 0 })
    const malformed = makeLedger({ generation: 7, outcomes: null })

    expect(summarizeLatestSettlement([valid, malformed])).toBeNull()
    expect(getSettlementGeneration(malformed)).toBe(7)
    const markup = renderToStaticMarkup(createElement(SettlementReport, { ledgers: [valid, malformed], onReviewGeneration: () => {} }))
    expect(markup).not.toContain('Review generation 7')
    expect(markup).toContain('Last recorded settlement for Generation 7 is unavailable.')
  })

  it('keeps core counts while marking malformed loss and cap fields unavailable', () => {
    const summary = summarizeSettlementReport(makeLedger({
      outcomes: { survived: 5, hunted: 1, energy: Number.NaN, unfed: 1, late: 1, aged: 1 },
      birthsEligible: 3,
      birthsCapped: Number.POSITIVE_INFINITY,
    }))!

    expect(summary).toMatchObject({ generation: 4, evaluatedCohort: 10, survivors: 5, admittedBirths: 2, exactNextPopulation: 7, totalLosses: null, cappedBirths: null })
    expect(summary.losses).toMatchObject({ hunted: 1, energy: null, unfed: 1, late: 1, aged: 1 })
    expect(formatSettlementLosses(summary)).toContain('Total losses unavailable')
    expect(formatSettlementBirthCap(summary)).toBe('Birth-cap count unavailable')
    const markup = renderToStaticMarkup(createElement(SettlementReport, { ledgers: [makeLedger({
      outcomes: { survived: 5, hunted: 1, energy: Number.NaN, unfed: 1, late: 1, aged: 1 },
      birthsEligible: 3,
      birthsCapped: Number.POSITIVE_INFINITY,
    })], onReviewGeneration: () => {} }))
    expect(markup).toContain('Total losses unavailable')
    expect(markup).toContain('Birth-cap count unavailable')
    expect(JSON.stringify(summary)).not.toMatch(/NaN|Infinity|"-\d/)
  })

  it('renders one actual-result group, one atomic polite status, and a review button', () => {
    const summary = summarizeSettlementReport(makeLedger())!
    const markup = renderToStaticMarkup(createElement(SettlementReport, { ledgers: [makeLedger()], onReviewGeneration: () => {} }))

    expect(markup).toContain('Last recorded settlement')
    expect(markup).toContain('Actual recorded result · Generation 4 → 5')
    expect(markup).toContain('not a counterfactual forecast')
    expect(markup).toContain('aria-label="Last recorded settlement, Generation 4 to 5"')
    expect(markup).toContain('Evaluated')
    expect(markup).toContain('Exact next population')
    expect(markup).toContain('Total losses')
    expect(markup).toContain('Capped births')
    expect(markup).toContain('Review generation 4')
    expect(markup.match(/role="group"/g)).toHaveLength(1)
    expect(markup.match(/role="status"/g)).toHaveLength(1)
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(markup).toContain('aria-atomic="true"')
    expect(markup).toContain(formatSettlementAnnouncement(summary))
    expect(formatSettlementAnnouncement(summary)).not.toContain('Exact next population')
    expect(markup).not.toContain('aria-live="assertive"')
  })

  it('shows every invalid loss cause explicitly in a partial record', () => {
    const partial = makeLedger({ outcomes: { survived: 5, hunted: Number.NaN, energy: -1, unfed: 1, late: Number.POSITIVE_INFINITY, aged: 'old' } })
    const summary = summarizeSettlementReport(partial)!
    const losses = formatSettlementLosses(summary)
    expect(losses).toContain('Hunted: unavailable')
    expect(losses).toContain('Energy depleted: unavailable')
    expect(losses).toContain('Missed return deadline: unavailable')
    expect(losses).toContain('Old age: unavailable')
    const markup = renderToStaticMarkup(createElement(SettlementReport, { ledgers: [partial], onReviewGeneration: () => {} }))
    expect(markup).toContain('Hunted: unavailable')
    expect(markup).toContain('Energy depleted: unavailable')
    expect(markup).toContain('Missed return deadline: unavailable')
    expect(markup).toContain('Old age: unavailable')
  })

  it('accepts a cap only when eligible, admitted, and capped births reconcile', () => {
    const valid = summarizeSettlementReport(makeLedger({ birthsEligible: 4, birthsAdmitted: 2, birthsCapped: 2 }))!
    expect(valid.eligibleParents).toBe(4)
    expect(valid.cappedBirths).toBe(2)

    for (const overrides of [
      { birthsEligible: 4, birthsAdmitted: 2, birthsCapped: 1 },
      { birthsEligible: 7, birthsAdmitted: 2, birthsCapped: 5 },
      { birthsEligible: 1, birthsAdmitted: 2, birthsCapped: 0 },
      { birthsEligible: 6, birthsAdmitted: 2, birthsCapped: 4 },
      { birthsEligible: undefined, birthsAdmitted: 2, birthsCapped: 0 },
    ]) {
      const invalid = summarizeSettlementReport(makeLedger(overrides))!
      expect(invalid.cappedBirths).toBeNull()
      if (typeof overrides.birthsEligible === 'number' && (overrides.birthsEligible < invalid.admittedBirths || overrides.birthsEligible > invalid.survivors)) {
        expect(invalid.eligibleParents).toBeNull()
      }
    }
    const legacy = makeLedger({ birthsEligible: undefined, birthsCapped: undefined })
    expect(summarizeSettlementReport(legacy)?.cappedBirths).toBeNull()
    const legacyMarkup = renderToStaticMarkup(createElement(SettlementReport, { ledgers: [legacy], onReviewGeneration: () => {} }))
    expect(legacyMarkup).toContain('Birth-cap count unavailable')
  })

  it('keeps exported formatters defensive against impossible caller-supplied summaries', () => {
    const valid = summarizeSettlementReport(makeLedger())!
    const impossibleBirths = { ...valid, survivors: 2, admittedBirths: 3, exactNextPopulation: 5 }
    expect(formatSettlementEquation(impossibleBirths)).toBe('Settlement equation unavailable')
    expect(formatSettlementAnnouncement(impossibleBirths)).toBe(SETTLEMENT_REPORT_UNAVAILABLE)

    expect(formatSettlementLosses({ ...valid, totalLosses: 4 })).toContain('Total losses unavailable')
    expect(formatSettlementLosses({ ...valid, losses: { ...valid.losses, hunted: 0 } })).toContain('Total losses unavailable')
    expect(formatSettlementBirthCap({ ...valid, cappedBirths: 0 })).toBe('Birth-cap count unavailable')
    expect(formatSettlementAnnouncement({ ...valid, cappedBirths: 0 })).toContain('Birth-cap count unavailable')
    expect(formatSettlementBirthCap({ ...valid, eligibleParents: valid.survivors + 1, cappedBirths: valid.survivors - valid.admittedBirths + 1 })).toBe('Birth-cap count unavailable')
  })

  it('rejects births above survivor capacity while preserving a truthful unavailable state', () => {
    const malformed = makeLedger({ outcomes: { survived: 2, hunted: 8, energy: 0, unfed: 0, late: 0, aged: 0 }, birthsEligible: 2, birthsAdmitted: 3, birthsCapped: 0 })
    expect(summarizeSettlementReport(malformed)).toBeNull()
    const markup = renderToStaticMarkup(createElement(SettlementReport, { ledgers: [malformed], onReviewGeneration: () => {} }))
    expect(markup).toContain(SETTLEMENT_REPORT_UNAVAILABLE)
    expect(markup).not.toContain('Review generation')
  })

  it('keeps the safe maximum generation boundary exact', () => {
    const generation = Number.MAX_SAFE_INTEGER - 1
    const summary = summarizeSettlementReport(makeLedger({ generation, startPopulation: 1, outcomes: { survived: 1, hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 }, birthsEligible: 0, birthsAdmitted: 0, birthsCapped: 0 }))!
    expect(summary.nextGeneration).toBe(Number.MAX_SAFE_INTEGER)
    expect(isValidSettlementNextGeneration(summary.nextGeneration)).toBe(true)
    expect(formatSettlementReportAriaLabel(summary)).toBe(`Last recorded settlement, Generation ${generation} to ${Number.MAX_SAFE_INTEGER}`)
    expect(formatSettlementAnnouncement(summary)).toContain(`Generation ${generation} → ${Number.MAX_SAFE_INTEGER}`)
    expect(getSettlementGeneration({ generation: Number.MAX_SAFE_INTEGER })).toBeNull()
  })

  it('does not render before the first retained ledger', () => {
    expect(renderToStaticMarkup(createElement(SettlementReport, { ledgers: [], onReviewGeneration: () => {} }))).toBe('')
    expect(summarizeLatestSettlement([])).toBeNull()
  })
})
