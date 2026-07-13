import type { ExperimentProgress, ExperimentResult, ExperimentPlan } from './types'

export type ExperimentWorkerRequest =
  | { type: 'run'; requestId: string; plan: ExperimentPlan; yieldEvery?: number }
  | { type: 'cancel'; requestId: string }

export type ExperimentWorkerEvent =
  | { type: 'progress'; requestId: string; progress: ExperimentProgress }
  | { type: 'result'; requestId: string; result: ExperimentResult }
  | { type: 'cancelled'; requestId: string; completedGenerationRuns: number }
  | { type: 'error'; requestId: string; message: string }
