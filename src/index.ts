import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, service: 'aetherium-api' }));

app.all('/*', (c) => c.json({ ok: true, message: 'Aetherium API (api.aetheriumos.com)' }, 200));

export default app;
