'use strict';

const { rebuildProfile, seedNode } = require('../interest/store');
const { signalWeight } = require('../interest/graph');

function topicFeatures(vocab, topicKey) {
  const cluster = vocab.clusterOf(topicKey);
  // Stable, bounded content features for inductive cold start. They are not
  // student traits; the signed interaction is supplied separately.
  const hash = [...topicKey].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 17);
  return [
    (hash % 997) / 997,
    ((hash >>> 5) % 991) / 991,
    ((hash >>> 11) % 983) / 983,
    cluster === 'other' ? 1 : 0.5,
  ];
}

function graphFeatures(vocab, kind, key) {
  const values = topicFeatures(vocab, key);
  values[3] = { topic: 1, genre: 0.75, entity: 0.5, article: 0.25, video: 0 }[kind] ?? 0.5;
  return values;
}

function contentTopics(value) {
  return Array.isArray(value)
    ? value.map(topic => (typeof topic === 'string' ? topic : topic?.key)).filter(Boolean)
    : [];
}

async function buildPreferenceGraph(prisma, vocab, studentId, preferences) {
  const [interestNodes, interestEdges, newsSignals, videoSignals] = await Promise.all([
    prisma.interestNode.findMany({ where: { studentId }, orderBy: { weight: 'desc' }, take: 300 }),
    prisma.interestEdge.findMany({ where: { studentId }, orderBy: { weight: 'desc' }, take: 500 }),
    prisma.newsSignal.findMany({
      where: { studentId, kind: { in: ['open', 'dwell', 'share', 'skip'] } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { article: { select: { id: true, topics: true } } },
    }),
    prisma.videoSignal.findMany({
      where: { studentId, kind: { in: ['open', 'dwell', 'share', 'skip'] } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { video: { select: { id: true, topics: true } } },
    }),
  ]);

  const nodes = new Map();
  const edges = [];
  const interactions = preferences.map(row => ({
    topicId: row.topicKey,
    stance: row.stance,
    weight: row.source === 'explicit' ? 2 : Math.max(0.1, row.confidence),
  }));
  for (const row of preferences) {
    nodes.set(row.topicKey, {
      topicId: row.topicKey,
      features: graphFeatures(vocab, 'topic', row.topicKey),
      baselineScore: row.muted ? -1 : (row.stance === 'LIKE' ? row.confidence : -row.confidence),
    });
  }
  const nodeId = (kind, key) => kind === 'topic' ? key : `${kind}:${key}`;
  for (const row of interestNodes) {
    const id = nodeId(row.kind, row.key);
    if (!nodes.has(id)) nodes.set(id, {
      topicId: id,
      features: graphFeatures(vocab, row.kind, row.key),
      baselineScore: Math.tanh(Math.max(0, row.weight) / 8),
    });
  }
  for (const edge of interestEdges) {
    const fromId = nodeId(edge.fromKind, edge.fromKey);
    const toId = nodeId(edge.toKind, edge.toKey);
    if (nodes.has(fromId) && nodes.has(toId)) edges.push({ fromId, toId });
  }

  const addContent = (kind, signal, content) => {
    const id = `${kind}:${content.id}`;
    if (!nodes.has(id)) nodes.set(id, {
      topicId: id,
      features: graphFeatures(vocab, kind, content.id),
      baselineScore: 0,
    });
    for (const topicKey of contentTopics(content.topics)) {
      if (!nodes.has(topicKey)) nodes.set(topicKey, {
        topicId: topicKey,
        features: graphFeatures(vocab, 'topic', topicKey),
        baselineScore: 0,
      });
      edges.push({ fromId: id, toId: topicKey });
    }
    const signedWeight = signalWeight(signal.kind, signal.dwellMs);
    if (signedWeight) interactions.push({
      topicId: id,
      stance: signedWeight < 0 ? 'DISLIKE' : 'LIKE',
      weight: Math.min(10, Math.max(0.1, Math.abs(signedWeight))),
    });
  };
  newsSignals.forEach(row => addContent('article', row, row.article));
  videoSignals.forEach(row => addContent('video', row, row.video));
  return { topics: [...nodes.values()].slice(0, 1000), interactions, edges: edges.slice(0, 10000) };
}

async function fetchPreferenceGnn({ url, token, payload }) {
  if (!url || !token) return null;
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/internal/gnn/v1/preference/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Service-Token': token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    return response.json();
  } catch (_) {
    return null;
  }
}

function trainingModelVersion(runKey) {
  const suffix = String(runKey || new Date().toISOString().slice(0, 10))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `preference-${suffix}`.slice(0, 80);
}

function isReclaimableRefreshLease(run, now = new Date()) {
  return Boolean(
    run?.status === 'running'
    && run.leaseExpiresAt
    && new Date(run.leaseExpiresAt).getTime() <= now.getTime(),
  );
}

function buildPreferenceTrainingSamples(studentGraphs, maxSamples = 5000) {
  const samples = [];
  for (const { graph, preferences } of studentGraphs) {
    for (const preference of preferences) {
      if (preference.muted || !['LIKE', 'DISLIKE'].includes(preference.stance)) continue;
      const hasTarget = graph.topics.some(topic => topic.topicId === preference.topicKey);
      if (!hasTarget) continue;

      // The held-out edge must not be recoverable from either the interaction
      // list or the deterministic topic prior. This turns the daily task into
      // genuine signed-edge reconstruction instead of label memorisation.
      samples.push({
        topics: graph.topics.map(topic => (topic.topicId === preference.topicKey
          ? { ...topic, baselineScore: 0 }
          : topic)),
        interactions: graph.interactions.filter(item => item.topicId !== preference.topicKey),
        edges: graph.edges,
        targetTopicId: preference.topicKey,
        targetStance: preference.stance,
      });
      if (samples.length >= maxSamples) return samples;
    }
  }
  return samples;
}

async function trainPreferenceGnn({ url, token, runKey, samples }) {
  if (!url || !token) return { attempted: false, reason: 'not_configured' };
  if (!samples.length) return { attempted: false, reason: 'no_training_samples' };
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/internal/gnn/v1/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Service-Token': token },
      body: JSON.stringify({
        lane: 'preference',
        modelVersion: trainingModelVersion(runKey),
        samples,
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) return { attempted: true, promoted: false, reason: `http_${response.status}` };
    return { attempted: true, ...(await response.json()) };
  } catch (_) {
    // Training is an optimisation, not a prerequisite for a valid snapshot.
    // The deterministic preference baseline remains authoritative on failure.
    return { attempted: true, promoted: false, reason: 'trainer_unavailable' };
  }
}

async function fetchPreferenceDecision({ url, token, preference, gnn }) {
  const score = (gnn?.scores || []).find(row => row.topicId === preference.topicKey);
  const baselineAffinity = preference.muted ? -1 : (preference.stance === 'LIKE' ? preference.confidence : -preference.confidence);
  const fallback = {
    topicId: preference.topicKey,
    affinity: preference.muted || preference.stance === 'DISLIKE' ? -1 : baselineAffinity,
    source: 'baseline',
    overrideApplied: preference.source === 'explicit' || preference.muted,
    ruleVersion: 'preference-baseline-v1',
    modelVersion: null,
    evidenceIds: [preference.evidenceRef || `preference:${preference.id}`],
  };
  if (!url || !token) return fallback;
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/decisions/v1/preference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Service-Token': token },
      body: JSON.stringify({
        topicId: preference.topicKey,
        baselineAffinity,
        gnnAffinity: score?.affinity ?? null,
        gnnEligible: Boolean(gnn?.eligible && score),
        gnnConfidence: Number(gnn?.confidence || 0),
        modelVersion: gnn?.modelVersion || null,
        hardStance: preference.muted ? 'MUTE' : (preference.source === 'explicit' ? preference.stance : null),
        evidenceIds: fallback.evidenceIds,
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return fallback;
    return response.json();
  } catch (_) {
    return fallback;
  }
}

async function refreshPreferenceProfiles(prisma, vocab, {
  runKey, gnnUrl, trainerUrl, decisionUrl, token, modelVersion = null,
}) {
  let run;
  const leaseStartedAt = new Date();
  const leaseExpiresAt = new Date(leaseStartedAt.getTime() + 2 * 60 * 60 * 1000);
  try {
    run = await prisma.preferenceRefreshRun.create({
      data: { runKey, status: 'running', leaseExpiresAt },
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      const existing = await prisma.preferenceRefreshRun.findUnique({ where: { runKey } });
      const reclaimable = isReclaimableRefreshLease(existing, leaseStartedAt);
      if (!reclaimable) return { started: false, status: existing?.status || 'unknown', runKey };
      const claimed = await prisma.preferenceRefreshRun.updateMany({
        where: { id: existing.id, status: 'running', leaseExpiresAt: { lte: leaseStartedAt } },
        data: {
          startedAt: leaseStartedAt,
          leaseExpiresAt,
          error: null,
          trainingStatus: 'not_started',
          trainingPromoted: false,
          trainingReason: null,
          completedAt: null,
        },
      });
      if (claimed.count !== 1) return { started: false, status: 'running', runKey };
      run = await prisma.preferenceRefreshRun.findUnique({ where: { id: existing.id } });
    } else {
      throw error;
    }
  }

  try {
    const students = await prisma.studentPreference.findMany({
      distinct: ['studentId'],
      select: { studentId: true },
    });
    let activeModelVersion = modelVersion;
    const studentGraphs = [];
    for (const { studentId } of students) {
      const rows = await prisma.studentPreference.findMany({ where: { studentId } });
      const graph = await buildPreferenceGraph(prisma, vocab, studentId, rows);
      studentGraphs.push({ studentId, preferences: rows, graph });
    }

    const training = await trainPreferenceGnn({
      url: trainerUrl,
      token,
      runKey,
      samples: buildPreferenceTrainingSamples(studentGraphs),
    });
    if (training.promoted && training.modelVersion) activeModelVersion = training.modelVersion;

    const stagedProfiles = [];
    for (const { studentId, preferences: rows, graph } of studentGraphs) {
      const result = graph.topics.length ? await fetchPreferenceGnn({
        url: gnnUrl,
        token,
        payload: { studentId, ...graph },
      }) : null;
      if (result?.eligible) activeModelVersion = result.modelVersion || activeModelVersion;
      const decisions = [];
      for (const preference of rows) {
        const decision = await fetchPreferenceDecision({
          url: decisionUrl, token, preference, gnn: result,
        });
        decisions.push({ preference, decision });
      }
      stagedProfiles.push({ studentId, decisions });
    }

    // All daily preference snapshots and derived ranking nodes advance as one
    // transaction. A failed run therefore leaves the last successful state
    // intact for every student, not just for the student that failed.
    await prisma.$transaction(async tx => {
      for (const { studentId, decisions } of stagedProfiles) {
        for (const { preference, decision } of decisions) {
          await tx.preferenceDecisionRecord.create({
            data: {
              studentId,
              topicKey: preference.topicKey,
              affinity: decision.affinity,
              source: decision.source,
              overrideApplied: Boolean(decision.overrideApplied),
              ruleVersion: decision.ruleVersion,
              modelVersion: decision.modelVersion,
              evidenceRefs: decision.evidenceIds || [],
            },
          });
          if (preference.muted || preference.stance === 'DISLIKE' || Number(decision.affinity) <= 0.1) {
            await tx.interestNode.deleteMany({ where: { studentId, kind: 'topic', key: preference.topicKey } });
          } else {
            await seedNode(tx, {
              studentId, kind: 'topic', key: preference.topicKey,
              weight: Math.max(1, Math.min(8, Number(decision.affinity) * 8)),
              origin: preference.source === 'explicit' ? 'confirmed' : 'behaviour',
            });
          }
        }
        await rebuildProfile(tx, studentId, { vocab });
      }
    }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 120000 });

    await prisma.preferenceRefreshRun.update({
      where: { id: run.id },
      data: {
        status: 'done',
        profileCount: students.length,
        modelVersion: activeModelVersion,
        trainingStatus: training.attempted ? (training.promoted ? 'promoted' : 'not_promoted') : 'skipped',
        trainingPromoted: Boolean(training.promoted),
        trainingReason: training.reason || null,
        leaseExpiresAt: null,
        completedAt: new Date(),
      },
    });
    return {
      started: true,
      status: 'done',
      runKey,
      profileCount: students.length,
      modelVersion: activeModelVersion,
      training,
    };
  } catch (error) {
    await prisma.preferenceRefreshRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        error: String(error.message || error).slice(0, 1000),
        leaseExpiresAt: null,
        completedAt: new Date(),
      },
    }).catch(() => {});
    throw error;
  }
}

module.exports = {
  topicFeatures,
  graphFeatures,
  buildPreferenceGraph,
  isReclaimableRefreshLease,
  buildPreferenceTrainingSamples,
  trainPreferenceGnn,
  fetchPreferenceDecision,
  refreshPreferenceProfiles,
};
