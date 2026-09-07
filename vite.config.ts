import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: '/BrainViewer/',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'neuroimaging-mime-types',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url) {
              const pathname = req.url.split('?')[0];
              // Intercept requests for /data/* assets to serve directly without Vite/sirv setting Content-Encoding: gzip
              const match = pathname.match(/\/?(data\/[^/]+)$/);
              if (match) {
                const relFile = match[1];
                const absFile = path.join(process.cwd(), 'public', relFile);
                if (fs.existsSync(absFile)) {
                  const stat = fs.statSync(absFile);
                  let contentType = 'application/octet-stream';
                  if (absFile.endsWith('.surf.gii') || absFile.endsWith('.gii')) {
                    contentType = 'application/xml; charset=utf-8';
                  } else if (absFile.endsWith('.nii.gz') || absFile.endsWith('.gz')) {
                    // Binary .nii.gz must be served as octet-stream without transport Content-Encoding
                    contentType = 'application/octet-stream';
                  } else if (absFile.endsWith('.nii') || absFile.endsWith('.dlabel.nii')) {
                    contentType = 'application/octet-stream';
                  }

                  res.writeHead(200, {
                    'Content-Type': contentType,
                    'Content-Length': stat.size,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=3600',
                  });

                  if (req.method === 'HEAD') {
                    res.end();
                    return;
                  }

                  fs.createReadStream(absFile).pipe(res);
                  return;
                }
              }
            }
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
