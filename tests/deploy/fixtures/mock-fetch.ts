// Preload for preview-smoke tests: no network. SMOKE_PREVIEW_DB / SMOKE_PROD_DB (or "none") set the /health db values.
globalThis.fetch = async (url) => {
  const isProd = String(url).includes('mfe-lab-api.vercel.app');
  const db = process.env[isProd ? 'SMOKE_PROD_DB' : 'SMOKE_PREVIEW_DB'];
  return Response.json(db === 'none' ? { status: 'ok' } : { status: 'ok', db });
};
