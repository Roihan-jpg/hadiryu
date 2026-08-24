import { createApp } from './app.js';

const port = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);

createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
