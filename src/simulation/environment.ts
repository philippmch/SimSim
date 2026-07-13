import type { Config,Environment,Food,World } from './types'
import { clamp,distance,random } from './random'

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
      if(valid(x,y,env,.04)){env.patches.push({id:state.nextId++,x,y});break}
    }
  }
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
  return Math.max(0,Math.round(env.foodBudget))
}

export function spawnFood(world:World,count:number):Food[]{
  const result:Food[]=[]
  for(let i=0;i<count;i++){
    for(let tries=0;tries<100;tries++){
      let x=.08+random(world)*.84,y=.08+random(world)*.84
      if(world.environment.patches.length&&random(world)<world.config.foodPatchiness){
        const patch=world.environment.patches[Math.floor(random(world)*world.environment.patches.length)]
        const spread=world.config.foodPatchSpread
        x=patch.x+(random(world)+random(world)+random(world)-1.5)*spread
        y=patch.y+(random(world)+random(world)+random(world)-1.5)*spread
      }
      x=clamp(x,.055,.945);y=clamp(y,.055,.945)
      if(valid(x,y,world.environment,.012)){result.push({id:world.nextId++,x,y});break}
    }
  }
  return result
}
