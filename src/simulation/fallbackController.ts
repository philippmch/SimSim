import { applyIntervention, createWorld, runGeneration, setInspectedIndividual } from './engine'
import { advanceToNextActionWithContext, runScheduled, scheduledTicks } from './scheduler'
import type { SimulationController, SimulationSnapshotMeta, SnapshotHandler } from './controller'
import type { WorkerCommand } from './protocol'
import type { Config, World } from './types'

/**
 * Run the simulation on the main thread when a module worker is unavailable.
 *
 * This module is intentionally kept behind the controller's dynamic fallback
 * import.  The worker-backed startup path can therefore load the UI without
 * pulling the simulation engine and scheduler into its initial JavaScript
 * chunk.
 */
export function fallbackController(initial: Config | World, onSnapshot: SnapshotHandler): SimulationController {
  let world = 'creatures' in initial ? structuredClone(initial) : createWorld(initial)
  let playing = false
  let speed = 1
  let last = performance.now()
  let remainder = 0
  const emitSnapshot = (meta?: SimulationSnapshotMeta) => onSnapshot(structuredClone(world), meta)
  const timer = setInterval(() => {
    if (!playing) return
    const now = performance.now()
    const schedule = scheduledTicks(Math.min(0.1, (now - last) / 1000), speed, remainder)
    last = now
    remainder = schedule.remainder
    runScheduled(world, schedule.count)
    if (!world.creatures.length) playing = false
    emitSnapshot()
  }, 50)
  try {
    emitSnapshot()
  } catch (error) {
    // `emitSnapshot` is part of construction: if a consumer throws while the
    // initial handoff is being delivered, the interval has already been
    // created and must be reclaimed before the error reaches the controller.
    clearInterval(timer)
    throw error
  }
  return {
    mode: 'fallback',
    send(command: WorkerCommand) {
      if (command.type === 'init' || command.type === 'reset') {
        world = createWorld(command.config)
        playing = false
        remainder = 0
        emitSnapshot()
      } else if (command.type === 'play') {
        playing = true
        last = performance.now()
      } else if (command.type === 'pause') {
        playing = false
      } else if (command.type === 'step') {
        playing = false
        last = performance.now()
        remainder = 0
        const { stepContext, stepResult } = advanceToNextActionWithContext(world)
        emitSnapshot({ stepId: command.stepId, stepResult, stepContext })
      } else if (command.type === 'speed') {
        speed = Math.max(0.5, Math.min(4, command.speed))
      } else if (command.type === 'inspect') {
        setInspectedIndividual(world, command.individualId)
        emitSnapshot()
      } else if (command.type === 'intervene') {
        applyIntervention(world, command.kind)
        emitSnapshot()
      } else if (command.type === 'finish') {
        playing = false
        runGeneration(world)
        emitSnapshot({ finishId: command.finishId })
      }
    },
    dispose() {
      clearInterval(timer)
    },
  }
}
