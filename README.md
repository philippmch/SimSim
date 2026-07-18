# Evolution Field Lab

An interactive, deterministic natural-selection sandbox. Creatures forage,
remember resources and danger, hunt, flee, return home, reproduce, and mutate
while live charts show selection taking shape across generations.

## Ecological behavior model

Each fixed simulation step is resolved in phases: perceive, decide, move and
metabolize, settle food contacts, settle attacks, then regrow resources.
Creatures have directional vision, reaction intervals, distance-dependent
detection, and obstacle occlusion. The selected creature shows its field of
view, current target, remembered locations, and compact perception counts.

In addition to speed, size, and sensing, creatures inherit aggression, caution,
and exploration. Decisions use short-term food and threat memories, target
commitment, travel safety, energy, expected hunting payoff, and correlated
wandering. Attacks are contests shaped by relative size, speed, energy,
aggression, and caution; attempts cost energy and impose a handling cooldown.

Founders begin with conservative standing variation by default (4% physical and
6% behavioral variation). This makes selection visible before the first birth
without overwhelming the configured starting means. Clonal, low-diversity, and
high-diversity controls are available; zero variation produces exactly equal
founders. Version-2 experiments migrate to zero founder variation so their prior
deterministic starting populations remain reproducible. Version-3 setups migrate
to classic lifecycle, perfect-perception, and threshold-predation modes. Fresh
version-4 setups use ecological modes, while all mechanisms remain switchable.

Biological individual and lineage identifiers are separate from transient render
objects. A surviving adult keeps its individual identifier across generations;
offspring receive a new identifier linked to their parent and lineage. The
generation ledger reconciles each starting individual as survived, hunted,
energy-depleted, unfed, late, or aged. Ecological survivors retain configurable
energy, reproduction deducts a cost, offspring receive a configured reserve, and
capacity-limited births use a seeded fair ranking. The ledger records production,
consumption, attack outcomes, birth capacity, and selection moments. Clicking a
creature opens bounded telemetry; long per-tick traces are not kept.

The seeded environment persists across generations. Food patches have visible
stock, bounded capacity, and deterministic within-generation regrowth. Remaining
food carries across generation boundaries in ecological mode. Obstacles persist,
and seasons, trend, and response rate change the resource target. Classic mode
retains the original generation-pulse food rules.

During a run, **Resource bloom**, **Drought**, and **Founder migration** apply
immediately without restarting. They obey the food and population safety caps
and are deterministic for a seed when replayed at the same simulation ticks. A
bounded event timeline records each shock. The Evolution story summarizes living
lineages, inverse-Simpson effective diversity, leading lineage shares, and the
latest survivor/reproducer trait shifts. Selecting a creature also highlights
its living lineage relatives in the arena.

## Experiment lab

The Experiment lab compares a control with a treatment across matched random
seeds. Choose a preset pressure, intervention generation, outcome, replicate
count, and fixed horizon; the chart reports both medians and middle-50%
intervals on one shared scale, plus the paired treatment-minus-control effect.
Runs use a separate worker when available and can be cancelled without changing
the live ecosystem. Results export as validated versioned JSON or tidy,
spreadsheet-safe CSV. A result seed can be staged in the live parameters for an
explicit replay on the next **Apply & restart**.

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
a separate linear energy cost. In ecological mode, positive-energy creatures
must return home before the generation ends, retain part of their reserve, and
reproduce only when they can pay the configured cost. In classic mode, one food
brought home survives and two also produce one offspring. These equations are
calibrated for legible dynamics rather than fitted to empirical data.

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

## Local-only status

The project is currently intended to run locally. Nothing in the app publishes,
uploads, or hosts a simulation. Use Node 20.19 or newer and `npm ci` when an exact
dependency install is needed; `npm run preview` only serves the production build
on the local machine for verification.
