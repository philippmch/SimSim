import type {Config,EcologyMode,PerceptionMode,PredationMode} from './types'

export const CONFIG_VERSION=5
export const MAX_POPULATION=120
export const MAX_FOUNDER_MIGRATION_BATCH=8
export const MAX_FOOD=180
export const MAX_HISTORY_POINTS=240
/** Fresh experiments opt into the v5 mechanics; legacy imports override these modes and use their historical maturity rule. */
export const defaultConfig:Config={ecologyMode:'energy-regrowth',perceptionMode:'realistic',predationMode:'contest',seed:2187,initialPopulation:42,foodPerDay:42,startSpeed:1,startSize:1,startSense:.18,startingEnergy:110,startAggression:.42,startCaution:.58,startExploration:.55,mutationRate:.05,mutationStrength:.1,mutateSpeed:true,mutateSize:true,mutateSense:true,mutateAggression:true,mutateCaution:true,mutateExploration:true,predatorRatio:1.2,moveEnergyFactor:.7,senseEnergyFactor:.32,dayLength:18,acceleration:.11,turnRate:4,memoryDuration:2.8,commitmentDuration:.8,foodPatchCount:4,foodPatchiness:.72,foodPatchSpread:.12,obstacleCount:4,seasonAmplitude:.22,seasonLength:8,environmentResponse:.45,foodTrend:0,founderPhysicalVariation:.04,founderBehaviorVariation:.06,
  // Energy units, generation counts, patch items/generation, degrees, and simulation-time units respectively.
  foodEnergy:22,preyEnergy:30,energyRetention:.65,reproductionEnergyCost:35,offspringEnergy:70,maxAge:24,maturityAge:1,patchCapacity:60,foodRegrowthRate:.18,fieldOfView:220,detectionFalloff:.65,reactionTime:.15,obstacleOcclusion:true,attackCost:4,handlingTime:.45,contestSharpness:4,evasionWeight:1}

export const CLASSIC_MODES={ecologyMode:'classic',perceptionMode:'perfect',predationMode:'threshold'} as const satisfies Pick<Config,'ecologyMode'|'perceptionMode'|'predationMode'>
export const V4_ONLY_CONFIG_KEYS=['ecologyMode','perceptionMode','predationMode','foodEnergy','preyEnergy','energyRetention','reproductionEnergyCost','offspringEnergy','maxAge','patchCapacity','foodRegrowthRate','fieldOfView','detectionFalloff','reactionTime','obstacleOcclusion','attackCost','handlingTime','contestSharpness','evasionWeight'] as const satisfies readonly (keyof Config)[]
/** The exact v4 envelope shape. Keep this explicit so a future config key cannot silently rewrite history. */
export const LEGACY_V4_CONFIG_KEYS=['ecologyMode','perceptionMode','predationMode','seed','initialPopulation','foodPerDay','startSpeed','startSize','startSense','startingEnergy','startAggression','startCaution','startExploration','mutationRate','mutationStrength','mutateSpeed','mutateSize','mutateSense','mutateAggression','mutateCaution','mutateExploration','predatorRatio','moveEnergyFactor','senseEnergyFactor','dayLength','acceleration','turnRate','memoryDuration','commitmentDuration','foodPatchCount','foodPatchiness','foodPatchSpread','obstacleCount','seasonAmplitude','seasonLength','environmentResponse','foodTrend','founderPhysicalVariation','founderBehaviorVariation','foodEnergy','preyEnergy','energyRetention','reproductionEnergyCost','offspringEnergy','maxAge','patchCapacity','foodRegrowthRate','fieldOfView','detectionFalloff','reactionTime','obstacleOcclusion','attackCost','handlingTime','contestSharpness','evasionWeight'] as const satisfies readonly (keyof Config)[]
export const V5_ONLY_CONFIG_KEYS=['maturityAge'] as const satisfies readonly (keyof Config)[]
/** The exact v3 envelope shape: the original 36 classic configuration keys. */
export const LEGACY_V3_CONFIG_KEYS=['seed','initialPopulation','foodPerDay','startSpeed','startSize','startSense','startingEnergy','startAggression','startCaution','startExploration','mutationRate','mutationStrength','mutateSpeed','mutateSize','mutateSense','mutateAggression','mutateCaution','mutateExploration','predatorRatio','moveEnergyFactor','senseEnergyFactor','dayLength','acceleration','turnRate','memoryDuration','commitmentDuration','foodPatchCount','foodPatchiness','foodPatchSpread','obstacleCount','seasonAmplitude','seasonLength','environmentResponse','foodTrend','founderPhysicalVariation','founderBehaviorVariation'] as const satisfies readonly (keyof Config)[]

type NumericKey={ [K in keyof Config]:Config[K] extends number?K:never }[keyof Config]
export const CONFIG_NUMERIC_RANGES:Record<NumericKey,readonly [number,number,boolean?]>={seed:[1,9999999,true],initialPopulation:[1,MAX_POPULATION,true],foodPerDay:[0,120,true],startSpeed:[.3,2.8],startSize:[.3,2.8],startSense:[.035,.6],startingEnergy:[10,500],startAggression:[0,1],startCaution:[0,1],startExploration:[0,1],mutationRate:[0,1],mutationStrength:[0,1],predatorRatio:[1.01,3],moveEnergyFactor:[.01,3],senseEnergyFactor:[0,2],dayLength:[5,60],acceleration:[.01,.5],turnRate:[.25,12],memoryDuration:[0,15],commitmentDuration:[0,8],foodPatchCount:[1,12,true],foodPatchiness:[0,1],foodPatchSpread:[.02,.35],obstacleCount:[0,12,true],seasonAmplitude:[0,.9],seasonLength:[2,60,true],environmentResponse:[.01,1],foodTrend:[-.1,.1],founderPhysicalVariation:[0,.35],founderBehaviorVariation:[0,.35],foodEnergy:[0,100],preyEnergy:[0,200],energyRetention:[0,1],reproductionEnergyCost:[0,300],offspringEnergy:[1,500],maxAge:[1,200,true],maturityAge:[0,200,true],patchCapacity:[1,MAX_FOOD,true],foodRegrowthRate:[0,1],fieldOfView:[15,360],detectionFalloff:[0,1],reactionTime:[0,5],attackCost:[0,100],handlingTime:[0,10],contestSharpness:[.1,20],evasionWeight:[0,5]}
const booleans:(keyof Config)[]=['mutateSpeed','mutateSize','mutateSense','mutateAggression','mutateCaution','mutateExploration','obstacleOcclusion']
const ecologyModes=new Set<EcologyMode>(['classic','energy-regrowth']),perceptionModes=new Set<PerceptionMode>(['perfect','realistic']),predationModes=new Set<PredationMode>(['threshold','contest'])
const configKeys=Object.keys(defaultConfig) as (keyof Config)[]
const configKeySet=new Set<string>(configKeys)
const validateConfigValues=(source:Record<string,unknown>,keys:readonly (keyof Config)[])=>{
  const keySet=new Set<string>(keys)
  if(keySet.has('ecologyMode')&&!ecologyModes.has(source.ecologyMode as EcologyMode))return false
  if(keySet.has('perceptionMode')&&!perceptionModes.has(source.perceptionMode as PerceptionMode))return false
  if(keySet.has('predationMode')&&!predationModes.has(source.predationMode as PredationMode))return false
  for(const key of booleans)if(keySet.has(key)&&typeof source[key]!=='boolean')return false
  for(const [key,[min,max,integer]]of Object.entries(CONFIG_NUMERIC_RANGES)as[NumericKey,readonly[number,number,boolean?]][]){
    if(!keySet.has(key))continue
    const value=source[key]
    if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))return false
  }
  return true
}
const exactConfigRecord=(input:unknown,keys:readonly (keyof Config)[],keySet:Set<string>)=>{
  if(!input||typeof input!=='object'||Array.isArray(input))return null
  const source=input as Record<string,unknown>,actual=Object.keys(source)
  if(actual.length!==keys.length||actual.some(key=>!keySet.has(key)))return null
  return source
}
/** Strict validation for current-version envelopes. Legacy migrations use dedicated historical validators. */
export function validateExactConfig(input:unknown):Config|null{
  const source=exactConfigRecord(input,configKeys,configKeySet)
  if(!source||!validateConfigValues(source,configKeys))return null
  return{...(source as unknown as Config)}
}

const legacyV4KeySet=new Set<string>(LEGACY_V4_CONFIG_KEYS)
/** Strictly validate and migrate a complete v4 config without changing its modes or values. */
export function validateLegacyV4Config(input:unknown):Config|null{
  const source=exactConfigRecord(input,LEGACY_V4_CONFIG_KEYS,legacyV4KeySet)
  if(!source||!validateConfigValues(source,LEGACY_V4_CONFIG_KEYS))return null
  return{...(source as unknown as Omit<Config,'maturityAge'>),maturityAge:0}
}
/** Alias emphasizing that a validated v4 config is normalized into the v5 shape. */
export const migrateLegacyV4Config=validateLegacyV4Config
export function sanitizeConfig(input:unknown):Config{
  const source=input&&typeof input==='object'?input as Record<string,unknown>:{}
  const out={...defaultConfig}
  for(const [key,[min,max,integer]] of Object.entries(CONFIG_NUMERIC_RANGES) as [NumericKey,readonly [number,number,boolean?]][]){const raw=source[key];if(typeof raw==='number'&&Number.isFinite(raw))out[key]=(integer?Math.round(Math.max(min,Math.min(max,raw))):Math.max(min,Math.min(max,raw))) as never}
  for(const key of booleans)if(typeof source[key]==='boolean')out[key]=source[key] as never
  if(ecologyModes.has(source.ecologyMode as EcologyMode))out.ecologyMode=source.ecologyMode as EcologyMode
  if(perceptionModes.has(source.perceptionMode as PerceptionMode))out.perceptionMode=source.perceptionMode as PerceptionMode
  if(predationModes.has(source.predationMode as PredationMode))out.predationMode=source.predationMode as PredationMode
  return out
}
export function sanitizeLegacyConfig(input:unknown,clonalFounders=false):Config{const source=input&&typeof input==='object'&&!Array.isArray(input)?input:{};return sanitizeConfig({...source,...CLASSIC_MODES,maturityAge:0,...(clonalFounders?{founderPhysicalVariation:0,founderBehaviorVariation:0}:{})})}
export function capPopulation<T extends{id:number}>(items:T[]){return [...items].sort((a,b)=>a.id-b.id).slice(0,MAX_POPULATION)}
