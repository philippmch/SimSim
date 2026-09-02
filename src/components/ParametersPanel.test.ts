import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultConfig } from '../simulation/config'
import type { Config } from '../simulation/types'
import ParametersPanel, { areParametersPanelPropsEqual, NumberControl, type ParametersPanelProps } from './ParametersPanel'

const props = (overrides: Partial<ParametersPanelProps> = {}): ParametersPanelProps => ({
  draft: { ...defaultConfig },
  liveConfig: { ...defaultConfig },
  dirty: false,
  actionStatus: '',
  runtimeMode: 'worker',
  setDraft: vi.fn() as ParametersPanelProps['setDraft'],
  onStatusChange: vi.fn(),
  onApply: vi.fn(),
  ...overrides,
})

describe('parameters panel', () => {
  it('skips equivalent cloned configs but notices every config and behavioral prop change', () => {
    const base = props()
    expect(areParametersPanelPropsEqual(base, { ...base, draft: { ...base.draft }, liveConfig: { ...base.liveConfig } })).toBe(true)

    const changedValue = (value: unknown) => typeof value === 'number' ? value + 1 : typeof value === 'boolean' ? !value : `${value}-changed`
    for (const key of Object.keys(defaultConfig) as (keyof Config)[]) {
      expect(areParametersPanelPropsEqual(base, { ...base, draft: { ...base.draft, [key]: changedValue(base.draft[key]) } })).toBe(false)
      expect(areParametersPanelPropsEqual(base, { ...base, liveConfig: { ...base.liveConfig, [key]: changedValue(base.liveConfig[key]) } })).toBe(false)
    }

    const behavioralChanges: Partial<ParametersPanelProps>[] = [
      { dirty: true },
      { actionStatus: 'Changed' },
      { runtimeMode: 'fallback' },
      { setDraft: vi.fn() as ParametersPanelProps['setDraft'] },
      { onStatusChange: vi.fn() },
      { onApply: vi.fn() },
    ]
    for (const change of behavioralChanges) expect(areParametersPanelPropsEqual(base, { ...base, ...change })).toBe(false)
  })

  it('renders the complete staged control surface without adding a layout wrapper', () => {
    const markup = renderToStaticMarkup(createElement(ParametersPanel, props({ dirty: true, actionStatus: 'Experiment imported.' })))

    expect(markup.startsWith('<div class="seed-row"')).toBe(true)
    expect(markup.match(/<fieldset>/g)).toHaveLength(7)
    for (const legend of ['Simulation model', 'World', 'Starting traits', 'Inheritance', 'Behavior &amp; motion', 'Environment &amp; seasons', 'Selection pressures']) expect(markup).toContain(`<legend>${legend}</legend>`)
    for (const id of ['seed', 'initial-population', 'speed', 'mutation-chance', 'starting-aggression', 'food-patches', 'contest-size-benchmark']) expect(markup).toContain(`id="${id}"`)
    expect(markup).toContain('Copy experiment link')
    expect(markup).toContain('Export experiment')
    expect(markup).toContain('Import experiment')
    expect(markup).toContain('Apply parameters &amp; restart')
    expect(markup).toContain('Experiment imported.')
  })

  it('keeps model, diversity, and mutation controls truthful for a classic draft', () => {
    const draft: Config = { ...defaultConfig, ecologyMode: 'classic', perceptionMode: 'perfect', predationMode: 'threshold', founderPhysicalVariation: 0, founderBehaviorVariation: 0, mutateSpeed: false, mutateAggression: false }
    const markup = renderToStaticMarkup(createElement(ParametersPanel, props({ draft, liveConfig: draft, runtimeMode: 'fallback', actionStatus: 'Ready' })))

    expect(markup).toContain('aria-pressed="true">Classic</button>')
    expect(markup).toContain('aria-pressed="false">Ecological</button>')
    expect(markup).not.toContain('Energy lifecycle tuning')
    expect(markup).not.toContain('Perception tuning')
    expect(markup).not.toContain('Attack contest tuning')
    expect(markup).toContain('Running in compatibility mode.')
    expect(markup).toContain('No staged changes')
    expect(markup).toContain('type="checkbox"')
  })

  it('shows the advanced maturity control and explains all three reproduction gates', () => {
    const markup = renderToStaticMarkup(createElement(ParametersPanel, props({ dirty: true })))

    expect(markup).toContain('Reproduction maturity age')
    expect(markup).toContain('id="reproduction-maturity-age"')
    expect(markup).toContain('min="0"')
    expect(markup).toContain('max="200"')
    expect(markup).toContain('step="1"')
    expect(markup).toContain('current age reaches 1 generation')
    expect(markup).toContain('retained energy strictly exceeds the reproduction cost')
    expect(markup).toContain('population capacity can also cap admitted births')
  })

  it('shows and explains a valid imported maturity age above the usual tuning range', () => {
    const draft = { ...defaultConfig, maturityAge: 200 }
    const markup = renderToStaticMarkup(createElement(ParametersPanel, props({ draft, liveConfig: draft })))

    expect(markup).toContain('id="reproduction-maturity-age"')
    expect(markup).toContain('value="200"')
    expect(markup).toContain('current age reaches 200 generations')
    expect(markup).not.toContain('current age reaches 80 generations')
  })

  it('converts a maturity slider interaction into a numeric staged value', () => {
    const onChange = vi.fn()
    const control = NumberControl({ label: 'Reproduction maturity age', value: 1, min: 0, max: 200, step: 1, unit: ' gen', onChange })
    const children = control.props.children as unknown as Array<{ props: { onChange?: (event: unknown) => void } }>
    children[1].props.onChange?.({ target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith(7)
  })
})
