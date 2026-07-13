import type {Config} from './types'

export const CONFIG_VERSION=3
export const MAX_POPULATION=120
export const MAX_FOOD=180
export const MAX_HISTORY_POINTS=240
export const defaultConfig:Config={seed:2187,initialPopulation:42,foodPerDay:42,startSpeed:1,startSize:1,startSense:.18,startingEnergy:110,startAggression:.42,startCaution:.58,startExploration:.55,mutationRate:.05,mutationStrength:.1,mutateSpeed:true,mutateSize:true,mutateSense:true,mutateAggression:true,mutateCaution:true,mutateExploration:true,predatorRatio:1.2,moveEnergyFactor:.7,senseEnergyFactor:.32,dayLength:18,acceleration:.11,turnRate:4,memoryDuration:2.8,commitmentDuration:.8,foodPatchCount:4,foodPatchiness:.72,foodPatchSpread:.12,obstacleCount:4,seasonAmplitude:.22,seasonLength:8,environmentResponse:.45,foodTrend:0,founderPhysicalVariation:.04,founderBehaviorVariation:.06}

type NumericKey={ [K in keyof Config]:Config[K] extends number?K:never }[keyof Config]
const ranges:Record<NumericKey,[number,number,boolean?]>={seed:[1,9999999,true],initialPopulation:[1,MAX_POPULATION,true],foodPerDay:[0,120,true],startSpeed:[.3,2.8],startSize:[.3,2.8],startSense:[.035,.6],startingEnergy:[10,500],startAggression:[0,1],startCaution:[0,1],startExploration:[0,1],mutationRate:[0,1],mutationStrength:[0,1],predatorRatio:[1.01,3],moveEnergyFactor:[.01,3],senseEnergyFactor:[0,2],dayLength:[5,60],acceleration:[.01,.5],turnRate:[.25,12],memoryDuration:[0,15],commitmentDuration:[0,8],foodPatchCount:[1,12,true],foodPatchiness:[0,1],foodPatchSpread:[.02,.35],obstacleCount:[0,12,true],seasonAmplitude:[0,.9],seasonLength:[2,60,true],environmentResponse:[.01,1],foodTrend:[-.1,.1],founderPhysicalVariation:[0,.35],founderBehaviorVariation:[0,.35]}
const booleans:(keyof Config)[]=['mutateSpeed','mutateSize','mutateSense','mutateAggression','mutateCaution','mutateExploration']
export function sanitizeConfig(input:unknown):Config{
  const source=input&&typeof input==='object'?input as Record<string,unknown>:{}
  const out={...defaultConfig}
  for(const [key,[min,max,integer]] of Object.entries(ranges) as [NumericKey,[number,number,boolean?]][]){const raw=source[key];if(typeof raw==='number'&&Number.isFinite(raw))out[key]=(integer?Math.round(Math.max(min,Math.min(max,raw))):Math.max(min,Math.min(max,raw))) as never}
  for(const key of booleans)if(typeof source[key]==='boolean')out[key]=source[key] as never
  return out
}
export function capPopulation<T extends{id:number}>(items:T[]){return [...items].sort((a,b)=>a.id-b.id).slice(0,MAX_POPULATION)}
