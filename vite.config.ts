import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base:'./',
  plugins:[react()],
  build:{
    rolldownOptions:{
      output:{
        codeSplitting:{
          groups:[{
            name:'react-vendor',
            test:/[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
          }],
        },
      },
    },
  },
})
