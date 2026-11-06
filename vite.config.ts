import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';

export default defineConfig({
 plugins:[react()],
 base:'/casovac/',
 build:{rollupOptions:{input:{
  main:resolve(process.cwd(),'index.html'),
  rawdebug:resolve(process.cwd(),'rawdebug/index.html')
 }}}
});
