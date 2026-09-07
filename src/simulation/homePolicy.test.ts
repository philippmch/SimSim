import {describe,expect,it,vi} from 'vitest'
import {createWorld,defaultConfig} from './engine'
import {chooseHomeMove,recordHomeDangerExperience,recordHomeFoodExperience} from './homePolicy'
import {movementScale,restingEnergyRate} from './energyPolicy'

const fixture=()=>{
  const world=createWorld({...defaultConfig,initialPopulation:1})
  const c=world.creatures[0]
  Object.assign(c,{homeX:.025,homeY:.3,speed:1,size:1,sense:1})
  return{c,cfg:world.config}
}
describe('experience-based home policy',()=>{
  it('records bounded running means independently from actual food and danger points',()=>{
    const {c}=fixture()
    recordHomeFoodExperience(c,.2,.4);recordHomeFoodExperience(c,.4,.8)
    recordHomeDangerExperience(c,.9,.1)
    expect(c.homeExperience).toEqual({foodCount:2,foodX:expect.closeTo(.3),foodY:expect.closeTo(.6),dangerCount:1,dangerX:.9,dangerY:.1})
    recordHomeFoodExperience(c,NaN,.5)
    expect(c.homeExperience!.foodCount).toBe(2)
    c.homeExperience!.dangerCount=1_000_000
    recordHomeDangerExperience(c,2,-1)
    expect(c.homeExperience!.dangerCount).toBe(1_000_000)
    expect(c.homeExperience!.dangerX).toBeLessThanOrEqual(1)
    expect(c.homeExperience!.dangerY).toBeGreaterThanOrEqual(0)
  })
  it('stays put without experience or when the current home is already closest to remembered food',()=>{
    const {c,cfg}=fixture()
    expect(chooseHomeMove(c,cfg,200)).toBeNull()
    recordHomeFoodExperience(c,.5,.3)
    expect(chooseHomeMove(c,cfg,200)).toBeNull()
  })
  it('moves toward remembered food only when round-trip savings exceed relocation cost',()=>{
    const {c,cfg}=fixture()
    recordHomeFoodExperience(c,.08,.8)
    const move=chooseHomeMove(c,cfg,200)!
    expect(move).toMatchObject({fromX:.025,fromY:.3,toX:.025,toY:.36,reason:'food'})
    expect(move.energyCost).toBeCloseTo(.06/(movementScale(cfg)*c.speed)*(restingEnergyRate(c,cfg)+cfg.moveEnergyFactor*c.size**3*c.speed**2),12)
    c.homeExperience!.foodX=.9;c.homeExperience!.foodY=.6
    expect(chooseHomeMove(c,cfg,200)).toBeNull()
  })
  it('moves away from experienced danger and combines compatible experience',()=>{
    const {c,cfg}=fixture()
    recordHomeDangerExperience(c,.025,.1)
    expect(chooseHomeMove(c,cfg,200)).toMatchObject({toY:.36,reason:'danger'})
    recordHomeFoodExperience(c,.08,.8)
    expect(chooseHomeMove(c,cfg,200)).toMatchObject({toY:.36,reason:'food-and-danger'})
  })
  it('balances conflicting food and danger rather than ignoring the downside',()=>{
    const {c,cfg}=fixture()
    recordHomeDangerExperience(c,.025,.8)
    recordHomeFoodExperience(c,.025,.8)
    expect(chooseHomeMove(c,cfg,200)).toBeNull()
  })
  it('rejects unaffordable moves and keeps classic homes fixed',()=>{
    const {c,cfg}=fixture()
    recordHomeFoodExperience(c,.08,.8)
    const move=chooseHomeMove(c,cfg,200)!
    expect(chooseHomeMove(c,cfg,cfg.startingEnergy*.25+move.energyCost)).toBeNull()
    expect(chooseHomeMove(c,{...cfg,ecologyMode:'classic'},200)).toBeNull()
  })
  it.each([
    [.025,.95,.025,1,.025,.975],
    [.975,.05,.975,0,.975,.025],
    [.95,.025,1,.025,.975,.025],
    [.05,.975,0,.975,.025,.975],
    [.025,.025,.025,.9,.025,.085],
  ])('keeps edge home (%s,%s) within bounds', (homeX,homeY,foodX,foodY,toX,toY)=>{
    const {c,cfg}=fixture()
    Object.assign(c,{homeX,homeY});recordHomeFoodExperience(c,foodX,foodY)
    const move=chooseHomeMove(c,cfg,200)!
    expect(move).not.toBeNull();expect(move.toX).toBeCloseTo(toX);expect(move.toY).toBeCloseTo(toY)
  })
  it('leaves non-edge imported homes untouched',()=>{
    const {c,cfg}=fixture();c.homeX=.5
    recordHomeFoodExperience(c,.5,.8)
    expect(chooseHomeMove(c,cfg,200)).toBeNull()
  })
  it('is deterministic, reads no RNG, and does not mutate the actor or config',()=>{
    const {c,cfg}=fixture();recordHomeFoodExperience(c,.08,.8)
    const before=structuredClone({c,cfg})
    const random=vi.spyOn(Math,'random').mockImplementation(()=>{throw new Error('No RNG allowed')})
    try{
      expect(chooseHomeMove(c,cfg,200)).toEqual(chooseHomeMove(c,cfg,200))
      expect({c,cfg}).toEqual(before)
    }finally{random.mockRestore()}
  })
})
