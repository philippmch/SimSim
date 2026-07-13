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
```

The public engine facade is `src/simulation/engine.ts`; deterministic random,
environment, behavior, and motion logic live in focused neighboring modules.
The same reset configuration reproduces the same run.
