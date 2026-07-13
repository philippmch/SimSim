/// <reference lib="webworker" />

import { ExperimentCancelledError, runExperiment } from './runner'
import type { ExperimentWorkerEvent, ExperimentWorkerRequest } from './protocol'

const controllers = new Map<string, AbortController>()

function post(event: ExperimentWorkerEvent): void {
  self.postMessage(event)
}

self.onmessage = async (message: MessageEvent<ExperimentWorkerRequest>) => {
  const request = message.data
  if (request.type === 'cancel') {
    controllers.get(request.requestId)?.abort()
    return
  }

  controllers.get(request.requestId)?.abort()
  const controller = new AbortController()
  controllers.set(request.requestId, controller)
  try {
    const result = await runExperiment(request.plan, {
      signal: controller.signal,
      yieldEvery: request.yieldEvery,
      onProgress: progress => post({ type: 'progress', requestId: request.requestId, progress }),
    })
    if (controllers.get(request.requestId) === controller) {
      post({ type: 'result', requestId: request.requestId, result })
    }
  } catch (error) {
    // A newer run may deliberately supersede this request id.
    if (controllers.get(request.requestId) !== controller) return
    if (error instanceof ExperimentCancelledError) {
      post({ type: 'cancelled', requestId: request.requestId, completedGenerationRuns: error.completedGenerationRuns })
    } else {
      post({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : 'Experiment failed' })
    }
  } finally {
    if (controllers.get(request.requestId) === controller) controllers.delete(request.requestId)
  }
}
