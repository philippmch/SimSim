import{describe,expect,it}from'vitest'
import{createWorld,defaultConfig,runGeneration}from'./engine'
import{CLASSIC_MODES}from'./config'

const rounded=(value:number|null)=>value===null?null:Number(value.toFixed(6))

describe('classic-mode compatibility fixture',()=>{
  it('preserves the established multi-seed generation probes',()=>{
    const probes=[11,99,919].map(seed=>{const world=createWorld({...defaultConfig,...CLASSIC_MODES,seed,initialPopulation:14,foodPerDay:30,dayLength:18});for(let generation=0;generation<3;generation++)runGeneration(world);return{seed,history:world.history.slice(1).map(point=>({generation:point.generation,population:point.population,avgSpeed:rounded(point.avgSpeed),avgSize:rounded(point.avgSize),avgSense:rounded(point.avgSense)})),ledgers:world.ledger.map(ledger=>{const{aged:_,...outcomes}=ledger.outcomes;return{outcomes,births:ledger.birthsAdmitted,foodConsumed:ledger.foodConsumed,preyConsumed:ledger.preyConsumed}})}})
    expect(probes).toMatchInlineSnapshot(`
      [
        {
          "history": [
            {
              "avgSense": 0.178592,
              "avgSize": 0.998463,
              "avgSpeed": 1.011799,
              "generation": 1,
              "population": 9,
            },
            {
              "avgSense": 0.179246,
              "avgSize": 0.995415,
              "avgSpeed": 1.011337,
              "generation": 2,
              "population": 8,
            },
            {
              "avgSense": 0.180912,
              "avgSize": 1.005799,
              "avgSpeed": 1.016212,
              "generation": 3,
              "population": 7,
            },
          ],
          "ledgers": [
            {
              "births": 3,
              "foodConsumed": 14,
              "outcomes": {
                "energy": 0,
                "hunted": 0,
                "late": 5,
                "survived": 6,
                "unfed": 3,
              },
              "preyConsumed": 0,
            },
            {
              "births": 3,
              "foodConsumed": 10,
              "outcomes": {
                "energy": 0,
                "hunted": 0,
                "late": 1,
                "survived": 5,
                "unfed": 3,
              },
              "preyConsumed": 0,
            },
            {
              "births": 3,
              "foodConsumed": 9,
              "outcomes": {
                "energy": 0,
                "hunted": 0,
                "late": 1,
                "survived": 4,
                "unfed": 3,
              },
              "preyConsumed": 0,
            },
          ],
          "seed": 11,
        },
        {
          "history": [
            {
              "avgSense": 0.18002,
              "avgSize": 0.997026,
              "avgSpeed": 1.017876,
              "generation": 1,
              "population": 9,
            },
            {
              "avgSense": 0.178757,
              "avgSize": 0.993889,
              "avgSpeed": 1.01322,
              "generation": 2,
              "population": 6,
            },
            {
              "avgSense": 0.179101,
              "avgSize": 0.991336,
              "avgSpeed": 1.02544,
              "generation": 3,
              "population": 6,
            },
          ],
          "ledgers": [
            {
              "births": 3,
              "foodConsumed": 12,
              "outcomes": {
                "energy": 0,
                "hunted": 0,
                "late": 3,
                "survived": 6,
                "unfed": 5,
              },
              "preyConsumed": 0,
            },
            {
              "births": 2,
              "foodConsumed": 9,
              "outcomes": {
                "energy": 0,
                "hunted": 0,
                "late": 3,
                "survived": 4,
                "unfed": 2,
              },
              "preyConsumed": 0,
            },
            {
              "births": 2,
              "foodConsumed": 7,
              "outcomes": {
                "energy": 0,
                "hunted": 0,
                "late": 1,
                "survived": 4,
                "unfed": 1,
              },
              "preyConsumed": 0,
            },
          ],
          "seed": 99,
        },
        {
          "history": [
            {
              "avgSense": 0.184826,
              "avgSize": 0.995235,
              "avgSpeed": 0.997934,
              "generation": 1,
              "population": 14,
            },
            {
              "avgSense": 0.186635,
              "avgSize": 0.997018,
              "avgSpeed": 1.000329,
              "generation": 2,
              "population": 14,
            },
            {
              "avgSense": 0.186952,
              "avgSize": 1.003961,
              "avgSpeed": 1.00515,
              "generation": 3,
              "population": 18,
            },
          ],
          "ledgers": [
            {
              "births": 4,
              "foodConsumed": 15,
              "outcomes": {
                "energy": 0,
                "hunted": 0,
                "late": 1,
                "survived": 10,
                "unfed": 3,
              },
              "preyConsumed": 0,
            },
            {
              "births": 6,
              "foodConsumed": 14,
              "outcomes": {
                "energy": 0,
                "hunted": 0,
                "late": 0,
                "survived": 8,
                "unfed": 6,
              },
              "preyConsumed": 0,
            },
            {
              "births": 8,
              "foodConsumed": 22,
              "outcomes": {
                "energy": 0,
                "hunted": 0,
                "late": 4,
                "survived": 10,
                "unfed": 0,
              },
              "preyConsumed": 0,
            },
          ],
          "seed": 919,
        },
      ]
    `)
  })
})
