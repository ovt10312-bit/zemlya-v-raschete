import {defineConfig} from 'vite';
export default defineConfig({build:{outDir:'dist/client',assetsInlineLimit:10000000},server:{proxy:{'/api':'http://127.0.0.1:8787'}}});
