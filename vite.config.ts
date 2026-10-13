import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import UnpluginInjectPreload from 'unplugin-inject-preload/vite';

const GIT_PROXY_PREFIX = '/git/';

/**
 * Forwards git smart-HTTP traffic to the remote. Bitbucket's git endpoints do
 * not send CORS headers, so the browser cannot talk to bitbucket.org directly;
 * isomorphic-git routes every request through its `corsProxy` (same-origin
 * `/git/<host>/...`), and this middleware relays them server-side.
 */
const gitProxyPlugin = (): Plugin => ({
    name: 'chartdb-git-proxy',
    configureServer(server) {
        server.middlewares.use(
            GIT_PROXY_PREFIX,
            (req: IncomingMessage, res: ServerResponse) => {
                // `middlewares.use('/git/', ...)` strips the mount prefix, so
                // req.url is already `/bitbucket.org/gmfrepository/...`.
                const url = req.url ?? '';
                const rest = url.startsWith(GIT_PROXY_PREFIX)
                    ? url.slice(GIT_PROXY_PREFIX.length)
                    : url;
                const trimmed = rest.startsWith('/') ? rest.slice(1) : rest;
                const slashIndex = trimmed.indexOf('/');
                if (slashIndex <= 0) {
                    res.statusCode = 400;
                    res.end('missing git host in proxy path');
                    return;
                }

                const host = trimmed.slice(0, slashIndex);
                const pathAndQuery = trimmed.slice(slashIndex);
                const headers = { ...req.headers, host };

                const proxyReq = httpsRequest(
                    {
                        host,
                        path: pathAndQuery,
                        method: req.method,
                        headers,
                    },
                    (proxyRes) => {
                        res.statusCode = proxyRes.statusCode ?? 502;
                        // Never forward the Basic-auth challenge: the browser
                        // shows a native username/password dialog on it, while
                        // isomorphic-git authenticates via the URL credentials.
                        delete proxyRes.headers['www-authenticate'];
                        for (const [name, value] of Object.entries(
                            proxyRes.headers
                        )) {
                            if (value !== undefined) {
                                res.setHeader(name, value);
                            }
                        }
                        proxyRes.pipe(res);
                    }
                );

                proxyReq.on('error', (error) => {
                    if (!res.headersSent) {
                        res.statusCode = 502;
                    }
                    res.end(`git proxy failed for ${host}: ${error.message}`);
                });

                req.pipe(proxyReq);
            }
        );
    },
});

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        gitProxyPlugin(),
        visualizer({
            filename: './stats/stats.html',
            open: false,
        }),
        UnpluginInjectPreload({
            files: [
                {
                    entryMatch: /logo-light.png$/,
                    outputMatch: /logo-light-.*.png$/,
                },
                {
                    entryMatch: /logo-dark.png$/,
                    outputMatch: /logo-dark-.*.png$/,
                },
            ],
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        rollupOptions: {
            external: (id) => /__test__/.test(id),
            output: {
                assetFileNames: (assetInfo) => {
                    if (
                        assetInfo.names &&
                        assetInfo.originalFileNames.some((name) =>
                            name.startsWith('src/assets/templates/')
                        )
                    ) {
                        return 'assets/[name][extname]';
                    }
                    return 'assets/[name]-[hash][extname]';
                },
            },
        },
    },
});
