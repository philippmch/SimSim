import type { NextActionContext, NextActionResult } from './scheduler'
import type { WorkerCommand, WorkerEvent } from './protocol'
import type { Config, World } from './types'

export interface SimulationSnapshotMeta {
  stepId?: number
  finishId?: number
  stepResult?: NextActionResult
  stepContext?: NextActionContext
}
export type SnapshotHandler = (world: World, meta?: SimulationSnapshotMeta) => void
export interface SimulationController {
  send(command: WorkerCommand): void
  dispose(): void
  readonly mode: 'worker' | 'fallback'
}

/** Keep worker callbacks tied to both the worker session and the active run. */
export function controllerEventIsCurrent(
  eventToken: number,
  currentToken: number,
  eventEpoch: number,
  currentEpoch: number,
  disposed: boolean,
) {
  return !disposed && eventToken === currentToken && eventEpoch === currentEpoch
}

type FallbackControllerModule = typeof import('./fallbackController')
type FallbackIntervention = Extract<WorkerCommand, { type: 'intervene' }>
type FallbackState = 'idle' | 'loading' | 'replaying' | 'ready' | 'failed'

function reportFallbackFailure(phase: string, error: unknown) {
  // The public controller API predates an error callback.  Keep failures
  // observable without changing that API, while the controller itself enters
  // a deterministic terminal state below.
  console.error(`[simulation] fallback ${phase} failed`, error)
}

/**
 * Create a worker-backed controller without importing the simulation engine on
 * the startup path.  The fallback module is requested only after a worker is
 * unavailable or has become unusable.
 */
export function createController(config: Config, onSnapshot: SnapshotHandler, onFallback: () => void): SimulationController {
  let active: SimulationController | undefined
  let disposed = false
  let runtimeMode: 'worker' | 'fallback' = 'worker'
  let currentConfig = config
  let latestWorld: World | undefined
  let playing = false
  let speed = 1
  let session = 0
  let runEpoch = 0
  let nextCommandId = 0
  let fallbackTransition = 0
  let fallbackModulePromise: Promise<FallbackControllerModule> | undefined
  let fallbackQueue: WorkerCommand[] = []
  let pendingInterventions: FallbackIntervention[] = []
  let fallbackState: FallbackState = 'idle'

  const loadFallbackModule = () => {
    if (!fallbackModulePromise) fallbackModulePromise = import('./fallbackController')
    return fallbackModulePromise
  }

  const switchToFallback = () => {
    if (disposed || runtimeMode === 'fallback') return
    runtimeMode = 'fallback'
    fallbackState = 'loading'
    const transition = ++fallbackTransition
    const handoffInitial = latestWorld ?? currentConfig
    session++
    active?.dispose()
    active = undefined
    fallbackQueue = []

    // Notify the app immediately.  A step or finish that the worker had not
    // acknowledged is intentionally treated as interrupted, even though the
    // fallback implementation may still be loading.
    onFallback()

    // Keep one promise per controller.  This makes repeated worker error
    // signals harmless and gives commands a single deterministic queue.
    const loading = loadFallbackModule()
    loading.then(
      module => {
        if (disposed || runtimeMode !== 'fallback' || transition !== fallbackTransition) return

        try {
          // The fallback emits its initial snapshot from the factory.  Leave
          // `active` unset until construction returns so commands raised by
          // that callback are queued and replayed after the baseline handoff.
          const fallback = module.fallbackController(handoffInitial, onSnapshot)
          if (disposed || runtimeMode !== 'fallback' || transition !== fallbackTransition) {
            fallback.dispose()
            return
          }
          active = fallback
          fallbackState = 'replaying'

          // Match the old synchronous handoff order: establish speed, replay
          // only interventions the worker did not acknowledge, then resume
          // playback.  Any command emitted synchronously by a snapshot
          // callback joins `fallbackQueue` and is drained below.
          active.send({ type: 'speed', speed })
          const replay = pendingInterventions
          pendingInterventions = []
          for (const command of replay) active.send({ type: 'intervene', kind: command.kind })
          if (playing && (latestWorld?.creatures.length ?? 1) > 0) active.send({ type: 'play' })

          while (fallbackQueue.length > 0) {
            const queued = fallbackQueue
            fallbackQueue = []
            for (const command of queued) {
              if (disposed || runtimeMode !== 'fallback' || transition !== fallbackTransition) return
              active.send(command)
            }
          }
          fallbackState = 'ready'
        } catch (error) {
          if (disposed || runtimeMode !== 'fallback' || transition !== fallbackTransition) return
          fallbackState = 'failed'
          fallbackQueue = []
          pendingInterventions = []
          active?.dispose()
          active = undefined
          reportFallbackFailure('initialization', error)
        }
      },
      error => {
        if (disposed || runtimeMode !== 'fallback' || transition !== fallbackTransition) return
        fallbackState = 'failed'
        fallbackQueue = []
        pendingInterventions = []
        active?.dispose()
        active = undefined
        reportFallbackFailure('module load', error)
      },
    )
  }

  if (typeof Worker !== 'undefined') {
    try {
      const token = ++session
      const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' })
      active = {
        mode: 'worker',
        send: command => worker.postMessage(command),
        dispose: () => worker.terminate(),
      }
      worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
        const data = event.data
        if (!controllerEventIsCurrent(token, session, data.epoch, runEpoch, disposed)) return
        if (data.type === 'snapshot') {
          latestWorld = data.world
          const acknowledged = data.lastCommandId
          if (acknowledged !== undefined) {
            pendingInterventions = pendingInterventions.filter(command => (command.commandId ?? 0) > acknowledged)
          }
          const meta = data.finishId !== undefined || data.stepResult
            ? { finishId: data.finishId, stepId: data.stepId, stepResult: data.stepResult, stepContext: data.stepContext }
            : undefined
          onSnapshot(data.world, meta)
        } else {
          switchToFallback()
        }
      }
      worker.onerror = () => {
        if (!disposed && token === session) switchToFallback()
      }
      worker.postMessage({ type: 'init', config, epoch: ++runEpoch } satisfies WorkerCommand)
    } catch {
      switchToFallback()
    }
  } else {
    switchToFallback()
  }

  const send = (command: WorkerCommand) => {
    if (disposed || fallbackState === 'failed') return

    let nextCommand = command
    if (command.type === 'init' || command.type === 'reset') {
      currentConfig = command.config
      latestWorld = undefined
      pendingInterventions = []
      nextCommandId = 0
      playing = false
      nextCommand = { ...command, epoch: ++runEpoch }
    } else if (command.type === 'play') {
      playing = true
    } else if (command.type === 'pause' || command.type === 'step' || command.type === 'finish') {
      playing = false
    } else if (command.type === 'speed') {
      speed = command.speed
    }

    if (command.type === 'intervene' && active?.mode === 'worker') {
      const tracked = { ...command, commandId: ++nextCommandId }
      pendingInterventions.push(tracked)
      active.send(tracked)
      return
    }

    if (active && (runtimeMode === 'worker' || fallbackState === 'ready')) {
      active.send(nextCommand)
    } else if (runtimeMode === 'fallback') {
      // Fallback chunk loading is asynchronous, while the public controller
      // remains synchronous.  Keep commands in arrival order until the lazy
      // implementation is ready; no command is ever sent to `undefined`.
      fallbackQueue.push(nextCommand)
    }
  }

  return {
    get mode() {
      return runtimeMode
    },
    send,
    dispose() {
      if (disposed) return
      disposed = true
      session++
      fallbackTransition++
      fallbackQueue = []
      active?.dispose()
      active = undefined
    },
  }
}

/**
 * Compatibility facade for callers that imported the fallback directly.
 *
 * The returned controller keeps the historical synchronous shape, but the
 * simulation implementation itself is loaded asynchronously for the same
 * startup-budget reason as createController.  Commands sent before the
 * module arrives are replayed in order once it is ready.
 */
export function fallbackController(initial: Config | World, onSnapshot: SnapshotHandler): SimulationController {
  let disposed = false
  let active: SimulationController | undefined
  let queue: WorkerCommand[] = []
  let state: Exclude<FallbackState, 'idle'> = 'loading'
  import('./fallbackController').then(
    module => {
      if (disposed) return
      try {
        const fallback = module.fallbackController(initial, onSnapshot)
        if (disposed) {
          fallback.dispose()
          return
        }
        active = fallback
        state = 'replaying'
        while (queue.length > 0) {
          const queued = queue
          queue = []
          for (const command of queued) {
            if (disposed) return
            active.send(command)
          }
        }
        state = 'ready'
      } catch (error) {
        if (disposed) return
        state = 'failed'
        queue = []
        active?.dispose()
        active = undefined
        reportFallbackFailure('initialization', error)
      }
    },
    error => {
      if (disposed) return
      state = 'failed'
      queue = []
      active?.dispose()
      active = undefined
      reportFallbackFailure('module load', error)
    },
  )
  return {
    mode: 'fallback',
    send(command) {
      if (disposed || state === 'failed') return
      if (active && state === 'ready') active.send(command)
      else queue.push(command)
    },
    dispose() {
      if (disposed) return
      disposed = true
      state = 'failed'
      queue = []
      active?.dispose()
      active = undefined
    },
  }
}
