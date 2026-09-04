import type { Config,Environment,Food,World } from './types'
import { clamp,distance,random } from './random'
import {defaultConfig,MAX_FOOD} from './config'
import {patchFoodEnergy,withPatchQualityBiases} from './patchQuality'
import type {ResourcePlacementSpec} from './resourceDynamics'

const valid=(x:number,y:number,env:Environment,margin=.012)=>x>margin&&x<1-margin&&y>margin&&y<1-margin&&!env.obstacles.some(o=>distance({x,y},o)<o.radius+margin)

export function createEnvironment(state:{rngState:number;nextId:number},cfg:Config):Environment{
  const env:Environment={patches:[],obstacles:[],foodBudget:cfg.foodPerDay,targetFood:cfg.foodPerDay}
  for(let i=0;i<cfg.obstacleCount;i++){
    for(let tries=0;tries<80;tries++){
      const radius=.035+random(state)*.035,x=.18+random(state)*.64,y=.18+random(state)*.64
      if(env.obstacles.every(o=>distance({x,y},o)>radius+o.radius+.035)){env.obstacles.push({id:state.nextId++,x,y,radius});break}
    }
  }
  for(let i=0;i<cfg.foodPatchCount;i++){
    for(let tries=0;tries<80;tries++){
      const x=.13+random(state)*.74,y=.13+random(state)*.74
      if(valid(x,y,env,.04)){env.patches.push({id:state.nextId++,x,y,stock:0,accumulator:0,spawnSequence:0});break}
    }
  }
  // Quality is assigned after all patch identities exist so the centering and
  // normalization are independent of placement order.  The helper is
  // stateless; this does not consume or perturb the world's mutable RNG.
  env.patches=withPatchQualityBiases(cfg.seed,env.patches)
  return env
}

export function seasonalTarget(cfg:Config,generation:number){
  const season=1+cfg.seasonAmplitude*Math.sin(Math.PI*2*(generation-1)/Math.max(2,cfg.seasonLength))
  const trend=Math.max(.15,1+cfg.foodTrend*(generation-1))
  return Math.max(0,cfg.foodPerDay*season*trend)
}

export function advanceFoodBudget(env:Environment,cfg:Config,generation:number){
  env.targetFood=seasonalTarget(cfg,generation)
  env.foodBudget+=cfg.environmentResponse*(env.targetFood-env.foodBudget)
  env.foodBudget=clamp(env.foodBudget,0,MAX_FOOD)
  return Math.max(0,Math.round(env.foodBudget))
}

/** Default budget preserves the configured base rate; the bounded environment budget scales it monotonically. */
export function effectiveFoodRegrowthRate(env:Environment,cfg:Config){return Math.max(0,cfg.foodRegrowthRate)*clamp(env.foodBudget,0,MAX_FOOD)/defaultConfig.foodPerDay}

export function spawnFood(world:World,count:number,cfg:Config=world.config):Food[]{
  const result:Food[]=[]
  for(let i=0;i<count;i++){
    for(let tries=0;tries<100;tries++){
      let x=.08+random(world)*.84,y=.08+random(world)*.84
      if(world.environment.patches.length&&random(world)<cfg.foodPatchiness){
        const patch=world.environment.patches[Math.floor(random(world)*world.environment.patches.length)]
        const spread=cfg.foodPatchSpread
        x=patch.x+(random(world)+random(world)+random(world)-1.5)*spread
        y=patch.y+(random(world)+random(world)+random(world)-1.5)*spread
      }
      x=clamp(x,.055,.945);y=clamp(y,.055,.945)
      if(valid(x,y,world.environment,.012)){
        const patch=nearestPatch(world,x,y)
        const energy=cfg.ecologyMode==='classic'?22:patchFoodEnergy(cfg.foodEnergy,patch?.qualityBias,cfg.patchQualityVariation)
        result.push({id:world.nextId++,x,y,patchId:patch?.id??null,energy})
        break
      }
    }
  }
  return result
}

const nearestPatch=(world:World,x:number,y:number)=>world.environment.patches.reduce<(typeof world.environment.patches)[number]|undefined>((best,patch)=>!best||distance({x,y},patch)<distance({x,y},best)||distance({x,y},patch)===distance({x,y},best)&&patch.id<best.id?patch:best,undefined)

export function syncPatchStocks(world:World){const counts=new Map<number,number>();for(const food of world.food)if(food.patchId!==null)counts.set(food.patchId,(counts.get(food.patchId)??0)+1);for(const patch of world.environment.patches)patch.stock=counts.get(patch.id)??0}

/** Advanced initialization keeps the first stable items per patch and never exceeds patch/global capacity. */
export function enforceAdvancedPatchCapacity(world:World){if(world.config.ecologyMode!=='energy-regrowth')return;const counts=new Map<number,number>(),kept:Food[]=[];for(const food of world.food){if(food.patchId===null)continue;const count=counts.get(food.patchId)??0;if(count>=world.config.patchCapacity||kept.length>=MAX_FOOD)continue;counts.set(food.patchId,count+1);kept.push(food)}world.food=kept;syncPatchStocks(world)}

/** Materializes pure regrowth placements without mutable RNG; patch centers are a deterministic obstacle-safe fallback. */
export function spawnRegrownFood(world:World,placements:readonly ResourcePlacementSpec[]):Food[]{
  const result:Food[]=[]
  for(const placement of placements){
    const patch=world.environment.patches.find(item=>item.id===placement.patchId)
    if(!patch)continue
    const point=valid(placement.x,placement.y,world.environment,.012)?placement:{x:patch.x,y:patch.y}
    const energy=world.config.ecologyMode==='classic'?22:patchFoodEnergy(world.config.foodEnergy,patch.qualityBias,world.config.patchQualityVariation)
    result.push({id:world.nextId++,x:point.x,y:point.y,patchId:patch.id,energy})
  }
  return result
}
