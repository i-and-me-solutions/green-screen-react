import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const host = env.VITE_LIGHTMAN_HOST || '192.168.88.99'
    const port = env.VITE_LIGHTMAN_PORT || '7042'

    return {
        plugins: [react()],
        resolve: {
            alias: {
                'green-screen-react/styles.css': path.resolve(__dirname, '../../packages/react/src/styles/terminal.css'),
                'green-screen-react': path.resolve(__dirname, '../../packages/react/src/index.ts'),
            },
        },
        server: {
            port: 5174,
            strictPort: true,
            proxy: {
                // Same-origin path keeps the browser out of CORS; /api/lightman/router → <host>:<port>/router
                '/api/lightman': {
                    target: `http://${host}:${port}`,
                    changeOrigin: true,
                    rewrite: (requestPath: string) => requestPath.replace(/^\/api\/lightman/, ''),
                },
            },
        },
    }
})
