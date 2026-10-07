'use strict';
/**
 * Express mount snippet — adapt paths to your app.
 * Requires: express.json() already enabled.
 */
const path = require('path');
const adapter = require('../example/app-adapter'); // or lib/app-adapter in host app
const { createAIService } = require('../ai-module/server/ai-service');
const { mountAIRoutes } = require('../ai-module/server/routes');
const { createFeedbackService, mountFeedbackRoutes } = require('../feedback-module/server/feedback-service');

function mountUniversalModules(app, opts = {}) {
  const dataDir = opts.dataDir || path.join(process.cwd(), 'data');
  const appName = opts.appName || 'Application';
  const appId = opts.appId || 'app';
  const version = opts.version || '1.0.0';

  const ai = createAIService({ dataDir, appName, adapter: opts.adapter || adapter });
  mountAIRoutes(app, ai);

  const fbOpts = { appId, appName, version };
  if (process.env.SHFH_HUB_ID) fbOpts.hubId = process.env.SHFH_HUB_ID;
  if (process.env.SHFH_HUB_URL) fbOpts.baseUrl = process.env.SHFH_HUB_URL;
  if (process.env.SHFH_INGEST_TOKEN) fbOpts.ingestToken = process.env.SHFH_INGEST_TOKEN;
  const fb = createFeedbackService(fbOpts);
  mountFeedbackRoutes(app, fb);

  return { ai, fb };
}

module.exports = { mountUniversalModules };
