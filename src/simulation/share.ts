import type {Config} from './types'
import {CONFIG_VERSION,defaultConfig,sanitizeConfig,sanitizeLegacyConfig,validateExactConfig} from './config'

export const STORAGE_KEY='evolution-field-lab:experiment:v4'
export const LEGACY_STORAGE_KEY='evolution-field-lab:experiment:v3'
export const LEGACY_V2_STORAGE_KEY='evolution-field-lab:experiment:v2'
export const MAX_EXPERIMENT_TEXT=64_000
export const MAX_EXPERIMENT_QUERY=12_000
type StorageLike={getItem(key:string):string|null;setItem(key:string,value:string):void}
type Experiment={version:number;config:Config}
const envelope=(config:Config):Experiment=>({version:CONFIG_VERSION,config:sanitizeConfig(config)})
export function exportExperiment(config:Config){return JSON.stringify(envelope(config),null,2)}
export function importExperiment(text:string):Config|null{
  if(typeof text!=='string'||text.length>MAX_EXPERIMENT_TEXT)return null
  try{const value=JSON.parse(text) as unknown;if(!value||typeof value!=='object'||Array.isArray(value))return null;const record=value as Record<string,unknown>
    if(record.version===1&&record.settings&&typeof record.settings==='object'&&!Array.isArray(record.settings))return sanitizeLegacyConfig(record.settings)
    if(record.version===0&&record.config&&typeof record.config==='object'&&!Array.isArray(record.config))return sanitizeLegacyConfig(record.config)
    if(record.version===2&&record.config&&typeof record.config==='object'&&!Array.isArray(record.config))return sanitizeLegacyConfig(record.config,true)
    if(record.version===3&&record.config&&typeof record.config==='object'&&!Array.isArray(record.config))return sanitizeLegacyConfig(record.config)
    if(record.version===CONFIG_VERSION){const keys=Object.keys(record);if(keys.length!==2||!keys.includes('version')||!keys.includes('config'))return null;return validateExactConfig(record.config)}
    if('version'in record)return null
    const legacyKeys=['seed','initialPopulation','foodPerDay'];if(legacyKeys.every(key=>typeof record[key]==='number'))return sanitizeLegacyConfig(record)
    return null
  }catch{return null}
}
export function encodeExperiment(config:Config){return encodeURIComponent(JSON.stringify(envelope(config)))}
export function decodeExperiment(value:string|null){if(!value||value.length>MAX_EXPERIMENT_QUERY)return null;try{return importExperiment(decodeURIComponent(value))}catch{return null}}
export function configFromSearch(search:string){try{return decodeExperiment(new URLSearchParams(search).get('experiment'))}catch{return null}}
export function loadInitialConfig(search:string,storage?:StorageLike|null){const fromUrl=configFromSearch(search);if(fromUrl)return fromUrl
  try{for(const key of [STORAGE_KEY,LEGACY_STORAGE_KEY,LEGACY_V2_STORAGE_KEY]){const stored=storage?.getItem(key);if(stored){const parsed=importExperiment(stored);if(parsed)return parsed}}}catch{/* denied storage */}return{...defaultConfig}}
export function persistExperiment(config:Config,storage?:StorageLike|null){const clean=sanitizeConfig(config);try{storage?.setItem(STORAGE_KEY,exportExperiment(clean))}catch{/* denied storage */}return clean}
export function experimentUrl(config:Config,base:string){const url=new URL(base);url.searchParams.set('experiment',encodeExperiment(config));return url.toString()}
