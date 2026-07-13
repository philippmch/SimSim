import{readdir,stat}from'node:fs/promises';import{join}from'node:path'
const budgets={'.js':300_000,'.css':30_000};let failed=false
for(const name of await readdir('dist/assets'))for(const [extension,budget]of Object.entries(budgets))if(name.endsWith(extension)){const bytes=(await stat(join('dist/assets',name))).size;console.log(`${name}: ${bytes} / ${budget} bytes`);if(bytes>budget)failed=true}
if(failed){console.error('Bundle size budget exceeded.');process.exit(1)}
