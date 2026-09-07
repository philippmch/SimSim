import type { BiologicalTrait, GenerationLedger } from './types'

/** Display-only selection interpretation, loaded with the generation journal. */
const traitKeys:BiologicalTrait[]=['speed','size','sense','aggression','caution','exploration']
const traitRanges:Record<BiologicalTrait,number>={speed:2.5,size:2.5,sense:.565,aggression:1,caution:1,exploration:1}
const traitDirections:Record<BiologicalTrait,readonly [string,string]>={speed:['slower','faster'],size:['smaller','larger'],sense:['narrower-sensing','broader-sensing'],aggression:['less aggressive','more aggressive'],caution:['less cautious','more cautious'],exploration:['less exploratory','more exploratory']}
export const SELECTION_SIGNAL_THRESHOLD=.2
export const SELECTION_PATTERN_THRESHOLD=.5
export const SELECTION_PATTERN_MIN_COUNT=3
export const SELECTION_THRESHOLD_TOLERANCE=1e-12
export function meetsStandardizedEffectThreshold(effect:number,threshold:number){return Number.isFinite(effect)&&Number.isFinite(threshold)&&Math.abs(effect)+SELECTION_THRESHOLD_TOLERANCE>=threshold}
export function snapStandardizedEffect(effect:number){
  if(!Number.isFinite(effect))return effect
  const magnitude=Math.abs(effect),sign=effect<0?-1:1
  if(Math.abs(magnitude-SELECTION_SIGNAL_THRESHOLD)<=SELECTION_THRESHOLD_TOLERANCE)return sign*SELECTION_SIGNAL_THRESHOLD
  if(Math.abs(magnitude-SELECTION_PATTERN_THRESHOLD)<=SELECTION_THRESHOLD_TOLERANCE)return sign*SELECTION_PATTERN_THRESHOLD
  return effect
}
const selectionDescriptions:Record<BiologicalTrait,readonly [string,string]>={speed:['slower speed','faster speed'],size:['smaller size','larger size'],sense:['narrower sensing','broader sensing'],aggression:['lower aggression','higher aggression'],caution:['lower caution','higher caution'],exploration:['lower exploration tendency','higher exploration tendency']}

type SelectionSignal={trait:BiologicalTrait;direction:string;effect:number;cohort:'survivor'|'reproducer';count:number}
function strongestSelectionSignal(ledger:GenerationLedger,cohort:SelectionSignal['cohort']):SelectionSignal|null{
  let strongest:SelectionSignal|null=null
  const count=cohort==='survivor'?ledger.outcomes.survived:ledger.birthsAdmitted
  for(const trait of traitKeys){
    const start=ledger.selection.start[trait],after=ledger.selection[cohort][trait]
    if(start.mean===null||start.sd===null||after.mean===null)continue
    const change=after.mean-start.mean,range=traitRanges[trait]
    if(start.sd<range*.005||Math.abs(change)<range*.005)continue
    const effect=change/start.sd
    if(!meetsStandardizedEffectThreshold(effect,SELECTION_SIGNAL_THRESHOLD)||strongest&&Math.abs(effect)<=Math.abs(strongest.effect))continue
    strongest={trait,direction:traitDirections[trait][effect<0?0:1],effect,cohort,count}
  }
  return strongest
}

/** Turns the latest selection moments into one cautious, comparable plain-language takeaway. */
export function getSelectionTakeaway(ledger:GenerationLedger|undefined){
  if(!ledger)return'Finish a generation to see whether trait shifts emerge.'
  if(ledger.outcomes.survived===0)return`Generation ${ledger.generation} ended with no survivors, so there is no trait shift to compare.`
  const survivor=strongestSelectionSignal(ledger,'survivor'),reproducer=ledger.birthsAdmitted?strongestSelectionSignal(ledger,'reproducer'):null
  if(!survivor&&!reproducer)return`Generation ${ledger.generation}: no clear signal passed the display thresholds (${SELECTION_SIGNAL_THRESHOLD} baseline-SD minimum plus baseline-spread and absolute-change floors).${ledger.birthsAdmitted?'':' No offspring were born.'}`
  const cohortLabel=(cohort:SelectionSignal['cohort'])=>cohort==='survivor'?'survivors':'parents of newborns'
  const effectLabel=(effect:number)=>{
    const displayEffect=snapStandardizedEffect(effect),magnitude=Math.abs(displayEffect)
    let decimals=2
    if(magnitude<SELECTION_PATTERN_THRESHOLD){
      while(decimals<12&&Number(magnitude.toFixed(decimals))>=SELECTION_PATTERN_THRESHOLD)decimals++
    }
    return`${displayEffect>=0?'+':'-'}${magnitude.toFixed(decimals)} baseline SD`
  }
  const signalDescription=(signal:SelectionSignal)=>selectionDescriptions[signal.trait][signal.effect<0?0:1]
  const signalText=(signal:SelectionSignal)=>`${cohortLabel(signal.cohort)} (n=${signal.count}) had ${signalDescription(signal)} on average than the evaluated cohort (${effectLabel(signal.effect)})`
  const patternEligible=(signal:SelectionSignal)=>signal.count>=SELECTION_PATTERN_MIN_COUNT&&meetsStandardizedEffectThreshold(signal.effect,SELECTION_PATTERN_THRESHOLD)
  const signalCategory=(signal:SelectionSignal):'pattern'|'slight'|'too-few'=>patternEligible(signal)?'pattern':signal.count<SELECTION_PATTERN_MIN_COUNT?'too-few':'slight'
  const appendNoBirths=(text:string)=>`${text}${ledger.birthsAdmitted?'':' No offspring were born.'}`
  if(survivor&&reproducer&&survivor.trait===reproducer.trait&&Math.sign(survivor.effect)===Math.sign(reproducer.effect)){
    const description=signalDescription(survivor)
    const survivorPattern=patternEligible(survivor),reproducerPattern=patternEligible(reproducer)
    if(survivorPattern&&reproducerPattern)return`Generation ${ledger.generation}: Possible shared pattern — descriptive, not causal: both cohorts had ${description} on average than the evaluated cohort (survivors n=${survivor.count}, ${effectLabel(survivor.effect)}; parents of newborns n=${reproducer.count}, ${effectLabel(reproducer.effect)}).`
    if(survivorPattern!==reproducerPattern){
      const strong=survivorPattern?survivor:reproducer,supporting=survivorPattern?reproducer:survivor
      const supportingCategory=signalCategory(supporting)
      const supportingText=supportingCategory==='too-few'
        ? `${cohortLabel(supporting.cohort)} (n=${supporting.count}) had a supporting too-few same-direction signal: ${signalDescription(supporting)} (${effectLabel(supporting.effect)}); too few observations to call a shared pattern`
        : `${cohortLabel(supporting.cohort)} (n=${supporting.count}) had a supporting slight same-direction signal: ${signalDescription(supporting)} (${effectLabel(supporting.effect)}), below the ${SELECTION_PATTERN_THRESHOLD} baseline-SD pattern threshold`
      return`Generation ${ledger.generation}: Possible pattern — descriptive, not causal: ${signalText(strong)}; ${supportingText}.`
    }
    if(signalCategory(survivor)==='too-few'||signalCategory(reproducer)==='too-few')return`Generation ${ledger.generation}: Too few observations to call a shared pattern: survivors (n=${survivor.count}) had ${description} (${effectLabel(survivor.effect)}); parents of newborns (n=${reproducer.count}) had ${description} (${effectLabel(reproducer.effect)}).`
    return`Generation ${ledger.generation}: Slight shared signal — not a pattern: both cohorts had ${description} on average than the evaluated cohort (survivors n=${survivor.count}, ${effectLabel(survivor.effect)}; parents of newborns n=${reproducer.count}, ${effectLabel(reproducer.effect)}). At least one cohort is below the ${SELECTION_PATTERN_THRESHOLD} baseline-SD pattern threshold.`
  }
  const signals=[survivor,reproducer].filter((signal):signal is SelectionSignal=>Boolean(signal))
  const patternSignals=signals.filter(patternEligible)
  const signal=(patternSignals.length?patternSignals:signals).reduce((best,current)=>!best||Math.abs(current.effect)>Math.abs(best.effect)?current:best,null as SelectionSignal|null)
  if(!signal)return''
  const category=signalCategory(signal)
  const result=category==='pattern'
    ? `Possible pattern — descriptive, not causal: ${signalText(signal)}`
    : category==='too-few'
      ? `Too few observations to call a pattern: ${signalText(signal)}`
      : `Slight signal — not a pattern: ${signalText(signal)}; below the ${SELECTION_PATTERN_THRESHOLD} baseline-SD pattern threshold`
  return appendNoBirths(`Generation ${ledger.generation}: ${result}.`)
}

