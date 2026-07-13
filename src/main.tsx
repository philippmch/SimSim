import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { ErrorBoundary } from './components/ErrorBoundary'

const root=document.getElementById('root')
if(root)createRoot(root).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>)
else{const fallback=document.createElement('p');fallback.textContent='Evolution Field Lab could not start because its page container is missing.';fallback.setAttribute('role','alert');document.body.append(fallback)}
