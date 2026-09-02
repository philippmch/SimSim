/**
 * Compatibility entry point for tests and integrations that historically
 * imported arena helpers and the canvas from one module. Production consumers
 * import ArenaCanvasModel or ArenaCanvasRenderer directly so the renderer can
 * stay out of the startup bundle.
 */
export * from './ArenaCanvasModel'
export * from './ArenaCanvasRenderer'
