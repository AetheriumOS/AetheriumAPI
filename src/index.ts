import { Hono } from 'hono';
import { phoneRoutes } from './phone';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, service: 'aetherium-api' }));

app.route('/phone', phoneRoutes);

app.all('/*', (c) => c.json({ ok: true, message: 'Aetherium API (api.aetheriumos.com)' }, 200));

export default app;
