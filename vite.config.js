import { defineConfig } from 'vite';
export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true, proxy: { '/api': {
    target: 'http://127.0.0.1:3000', changeOrigin: true,
    configure(proxy) { proxy.on('proxyReq',(proxyReq,req)=>{
      if (['http://localhost:5173','http://127.0.0.1:5173'].includes(req.headers.origin)) proxyReq.setHeader('Origin','http://127.0.0.1:3000');
    }); },
  } } },
});
