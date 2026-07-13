# Evolution Field Lab

An interactive, deterministic natural-selection sandbox. Creatures forage,
remember resources and danger, hunt, flee, return home, reproduce, and mutate
while live charts show selection taking shape across generations.

## Behavior V2 model

Each fixed simulation step is resolved in phases. Creatures first observe the
same immutable world state and choose a utility-scored action. Their accelerated,
momentum-based movement is then resolved against bounds and circular obstacles.
Finally, food and predation contacts are settled simultaneously with stable-ID
tie-breaking, so changing array order cannot change the ecology.

In addition to speed, size, and sensing, creatures inherit aggression, caution,
and exploration. Decisions use short-term food and threat memories, target
commitment, travel safety, energy, and correlated wandering. Urgent threats and
the need to get food home can override a committed target.

The seeded environment persists across generations. Food grows around visible
patches, obstacles remain fixed, and a configurable seasonal cycle, long-term
trend, and response rate gradually change each generation's food budget.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite. No accounts, services, or external
runtime assets are required.

## Checks

```bash
npm test
npm run build
npm run check
npm run preview
```

The public engine facade is `src/simulation/engine.ts`; deterministic random,
environment, behavior, and motion logic live in focused neighboring modules.
The same reset configuration reproduces the same run.

## Assumptions and limitations

This is an educational toy model, not a biological prediction. Creatures are
asexual, traits are scalar, offspring mutation is simplified, and the square
arena omits genetics, disease, social behavior, and real ecosystem complexity.
Do not use its outcomes to infer the behavior of real species or populations.

Locomotion pressure is proportional to `size³ × actual velocity²`; sensing adds
a separate linear energy cost. A creature returning with one resource survives,
while two resources also produce one offspring. Utility scores combine distance,
need, risk, memory, and estimated time and energy to reach home. These equations
are deliberately calibrated for legible interactive dynamics rather than fitted
to empirical data.

## Reproducibility and privacy

Applied experiments are encoded as versioned configuration data. “Copy
experiment link” stores the full sanitized setup in the URL; export and import
use the same versioned JSON envelope. URL configuration takes precedence over
local storage, which takes precedence over defaults. Simulation seeds and stable
fixed-step updates reproduce the same run.

Everything runs in the browser. There are no accounts, analytics, server calls,
or uploads. Experiment links place configuration—not simulation history—in the
URL. Exported files remain on the user's device.

## Browser and performance support

Current stable Chrome, Edge, Firefox, and Safari are supported. A module worker
owns playback where available; a bounded, visibly identified main-thread mode is
used when workers are unavailable. Reduced-motion preferences start playback
paused. Population is capped at 120 and seasonal food at 180 to protect the
quadratic interaction model. Up to 240 generation summaries are retained; the
charts show the latest 40. The high-load test uses a generous five-second
threshold intended only to catch catastrophic regressions; timings vary by
machine and CI load.

## Release and deployment

Use Node 20.19 or newer and install exact dependencies with `npm ci`. Before a
release run `npm audit --audit-level=high` and `npm run check`. The production
artifact is `dist/`; validate it with `npm run preview`. Replace the placeholder
canonical/social metadata in `index.html` with the final public URL and preview
image during deployment. No runtime environment variables are required.
