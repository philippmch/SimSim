import{readFile,readdir,stat}from'node:fs/promises'
import{join}from'node:path'

const budgets={'.js':300_000,'.css':30_000},startupJsBudget=300_000
let failed=false
for(const name of await readdir('dist/assets'))for(const [extension,budget]of Object.entries(budgets))if(name.endsWith(extension)){
  const bytes=(await stat(join('dist/assets',name))).size
  console.log(`${name}: ${bytes} / ${budget} bytes`)
  if(bytes>budget)failed=true
}

const html=await readFile('dist/index.html','utf8')
const startupNames=new Set([
  ...[...html.matchAll(/<script\b[^>]*\bsrc="\.\/assets\/([^"]+\.js)"/g)].map(match=>match[1]),
  ...[...html.matchAll(/<link\b(?=[^>]*\brel="modulepreload")[^>]*\bhref="\.\/assets\/([^"]+\.js)"/g)].map(match=>match[1]),
])
const startupBytes=(await Promise.all([...startupNames].map(name=>stat(join('dist/assets',name))))).reduce((sum,item)=>sum+item.size,0)
console.log(`startup JS (${[...startupNames].join(' + ')}): ${startupBytes} / ${startupJsBudget} bytes`)
if(!startupNames.size||startupBytes>startupJsBudget)failed=true

if(failed){console.error('Bundle size budget exceeded.');process.exit(1)}
