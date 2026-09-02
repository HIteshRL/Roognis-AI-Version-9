'use strict';

/**
 * Reading the live ingested corpus from the RAG service.
 *
 * This is the only impure part of the demo-history pipeline. It is kept in its
 * own module so `demo-plan.js` stays pure and synchronous — that purity is what
 * lets three uncoordinated seeder containers expand the same fixture into the
 * same rows. The seeders call this first and inject the result.
 *
 * `fetchFn` is injectable so the tests never touch the network.
 */

/** RAG is unreachable, or rejected us. A misconfiguration — must be loud. */
class RagUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RagUnavailableError';
  }
}

/** RAG answered, and there is simply nothing ingested yet. A clean skip. */
class NoReadyChaptersError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoReadyChaptersError';
  }
}

const DEFAULTS = {
  ragServiceUrl: 'http://rag:3003',
  timeoutMs: 10000,
  attempts: 5,
  backoffMs: 3000,
};

function resolveConfig(options = {}) {
  return {
    ...DEFAULTS,
    ragServiceUrl: options.ragServiceUrl || process.env.RAG_SERVICE_URL || DEFAULTS.ragServiceUrl,
    internalServiceToken: options.internalServiceToken || process.env.INTERNAL_SERVICE_TOKEN || '',
    fetchFn: options.fetchFn || fetch,
    sleepFn: options.sleepFn || (ms => new Promise(resolve => setTimeout(resolve, ms))),
    timeoutMs: options.timeoutMs || DEFAULTS.timeoutMs,
    attempts: options.attempts || DEFAULTS.attempts,
    backoffMs: options.backoffMs == null ? DEFAULTS.backoffMs : options.backoffMs,
  };
}

/**
 * One GET, with retries on transport failure and 5xx only.
 *
 * A 401/403 is a wrong or missing INTERNAL_SERVICE_TOKEN and retrying it just
 * delays the error by fifteen seconds, so 4xx fails immediately.
 */
async function getJson(path, config) {
  const { ragServiceUrl, internalServiceToken, fetchFn, sleepFn, timeoutMs, attempts, backoffMs } = config;
  const url = `${ragServiceUrl.replace(/\/+$/, '')}${path}`;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetchFn(url, {
        headers: { 'x-internal-service-token': internalServiceToken },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = new RagUnavailableError(`RAG request failed (${url}): ${error.message}`);
      if (attempt < attempts) {
        await sleepFn(backoffMs);
        continue;
      }
      throw lastError;
    }

    if (response.status === 404) return null;

    if (response.status >= 400 && response.status < 500) {
      const detail = response.status === 401 || response.status === 403
        ? ' — check INTERNAL_SERVICE_TOKEN'
        : '';
      throw new RagUnavailableError(`RAG rejected the request (HTTP ${response.status}${detail}): ${url}`);
    }

    if (!response.ok) {
      lastError = new RagUnavailableError(`RAG returned HTTP ${response.status}: ${url}`);
      if (attempt < attempts) {
        await sleepFn(backoffMs);
        continue;
      }
      throw lastError;
    }

    return response.json();
  }

  throw lastError || new RagUnavailableError(`RAG request failed: ${url}`);
}

/**
 * Every ready chapter for a school, optionally narrowed to one grade.
 *
 * RAG already sorts these deterministically by
 * (schoolId, subject, grade, chapterNumber, chapterName), which is what makes
 * the downstream selection reproducible.
 */
async function fetchReadyChapters(options = {}) {
  const { schoolId, grade, subject } = options;
  if (!schoolId) throw new Error('fetchReadyChapters requires a schoolId.');

  const config = resolveConfig(options);
  if (!config.internalServiceToken) {
    throw new RagUnavailableError(
      'INTERNAL_SERVICE_TOKEN is not set — the demo seeder cannot read the ingested corpus.',
    );
  }

  const params = new URLSearchParams({ schoolId });
  if (grade != null) params.set('grade', String(grade));
  if (subject) params.set('subject', subject);

  const payload = await getJson(`/api/rag/internal/chapters?${params.toString()}`, config);
  return (payload && Array.isArray(payload.chapters)) ? payload.chapters : [];
}

/**
 * Chunks and extracted entities for one chapter.
 *
 * Addressed by `documentIds` rather than the nine-field chapter identity — the
 * same shortcut `services/quiz/lib/generation.js` uses. Returns null when RAG
 * 404s, which it does when no ready documents match.
 */
async function fetchChapterContext(chapter, options = {}) {
  const config = resolveConfig({ timeoutMs: 20000, ...options });
  const documentIds = Array.isArray(chapter.documentIds) ? chapter.documentIds : [];
  if (!documentIds.length) return null;

  const params = new URLSearchParams({
    documentIds: documentIds.join(','),
    // The endpoint caps maxChunks at 120.
    maxChunks: String(Math.min(120, Number(options.maxChunks) || 120)),
  });

  return getJson(`/api/rag/internal/chapter-context?${params.toString()}`, config);
}

module.exports = {
  RagUnavailableError,
  NoReadyChaptersError,
  fetchReadyChapters,
  fetchChapterContext,
};
