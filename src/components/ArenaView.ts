export interface ArenaView { zoom: number; x: number; y: number }
export const INITIAL_ARENA_VIEW: ArenaView = { zoom: 1, x: .5, y: .5 }
export function clampArenaView(view: ArenaView): ArenaView {
  const zoom = Math.max(1, Math.min(4, view.zoom))
  const edge = .5 / zoom
  return { zoom, x: Math.max(edge, Math.min(1 - edge, view.x)), y: Math.max(edge, Math.min(1 - edge, view.y)) }
}
/** Coordinates are fractions of the canvas, including its field padding. */
export function arenaViewToScreen(view: ArenaView, point: { x: number; y: number }) {
  return { x: .5 + (point.x - view.x) * view.zoom, y: .5 + (point.y - view.y) * view.zoom }
}
export function arenaViewFromScreen(view: ArenaView, point: { x: number; y: number }) {
  return { x: view.x + (point.x - .5) / view.zoom, y: view.y + (point.y - .5) / view.zoom }
}
export function panArenaView(view: ArenaView, dx: number, dy: number) {
  return clampArenaView({ ...view, x: view.x - dx / view.zoom, y: view.y - dy / view.zoom })
}
