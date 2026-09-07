import type { World, Mode } from '../simulation/types'
import './FieldOverview.css'

export function describeField(world: World) {
  const living = world.creatures.filter(c => c.alive)
  if (!living.length) return world.creatures.length
    ? 'No creatures remain alive this generation. Finish generation to record what happened.'
    : 'The population is extinct. Open Change the environment to introduce new founders, or restart the run.'
  const home = living.filter(c => c.home).length
  if (home === living.length) return world.config.ecologyMode === 'energy-regrowth'
    ? 'Everyone is resting at home. Energy still falls; hungry creatures may head out again if time allows.'
    : 'Everyone is home. Play advances to the next generation, or choose Finish generation.'
  const counts: Record<Mode, number> = { exploring: 0, foraging: 0, hunting: 0, fleeing: 0, returning: 0 }
  for (const c of living) if (!c.home) counts[c.mode]++
  const [mode, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  const actions: Record<string, string> = { exploring: 'exploring the arena', foraging: 'looking for food', hunting: 'pursuing prey', fleeing: 'avoiding a threat', returning: 'heading home' }
  const subject = count > living.length / 2 ? 'Most creatures are' : `${count} ${count === 1 ? 'creature is' : 'creatures are'}`
  const food = world.food.length === 0 ? 'There is no food on the ground right now.' : `${world.food.length} food ${world.food.length === 1 ? 'item remains' : 'items remain'} on the ground.`
  return `${subject} ${actions[mode]}. ${food}`
}

export default function FieldOverview({ world }: { world: World }) {
  return <section className="field-overview" aria-label="What is happening now">
    <div><h2>Life in the arena</h2><p>{describeField(world)}</p></div>
    <p className="field-invitation">Click a creature to see what it is doing and why.</p>
  </section>
}
