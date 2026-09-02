'use client';

import { useCallback, useEffect, useState } from 'react';
import { learningEvents } from '@/lib/learning-events';

type Preference = {
  topicId: string;
  label: string;
  stance: 'LIKE' | 'DISLIKE';
  source: string;
  confidence: number;
  muted: boolean;
};

type KnowledgeGap = {
  conceptId: string;
  mastery: number;
  gapScore: number;
  confidence: number;
  evidenceCount: number;
  decisionSource: 'gnn' | 'baseline';
};

async function graphQl<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch('/api/discover/graphql', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((error: { message: string }) => error.message).join('; ') || 'Preference request failed.');
  }
  return payload.data;
}

export default function Page() {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [status, setStatus] = useState('Loading private learner state…');

  const refresh = useCallback(async () => {
    try {
      const [preferenceData, gapResponse] = await Promise.all([
        graphQl<{ myPreferences: Preference[] }>('query MyPreferences { myPreferences { topicId label stance source confidence muted } }'),
        fetch('/api/psv/v1/me/knowledge-gaps', { credentials: 'include' }),
      ]);
      const gapData = gapResponse.ok ? await gapResponse.json() : { knowledgeGaps: [] };
      setPreferences(preferenceData.myPreferences);
      setGaps(gapData.knowledgeGaps || []);
      setStatus('Private student view');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Learner state is unavailable.');
    }
  }, []);

  useEffect(() => {
    void learningEvents();
    void refresh();
  }, [refresh]);

  async function setPreference(topicId: string, stance: 'LIKE' | 'DISLIKE') {
    await graphQl('mutation SetPreference($topicId: ID!, $stance: PreferenceStance!) { setPreference(topicId: $topicId, stance: $stance) { topicId } }', { topicId, stance });
    await refresh();
  }

  async function mutatePreference(query: string, topicId: string) {
    await graphQl(query, { topicId });
    await refresh();
  }

  return (
    <main className="learner-state-page">
      <header className="learner-state-head">
        <div>
          <p className="eyebrow">Roognis student portal</p>
          <h1>Your learner state</h1>
          <p className="subtext">Preferences personalize examples. Academic evidence controls support and practice. The two stores remain separate.</p>
        </div>
        <span className="pill">{status}</span>
      </header>

      <section className="learner-state-grid">
        <article className="panel">
          <div className="panel-header"><h2>Private preferences</h2></div>
          <div className="panel-body state-list">
            {preferences.length === 0 && <p className="subtext">No saved preferences yet.</p>}
            {preferences.map(preference => (
              <div className="state-row" key={preference.topicId}>
                <div><strong>{preference.label}</strong><p>{preference.muted ? 'Muted' : preference.stance.toLowerCase()} · {preference.source.replaceAll('_', ' ')}</p></div>
                <div className="actions">
                  <button className="btn" onClick={() => void setPreference(preference.topicId, preference.stance === 'LIKE' ? 'DISLIKE' : 'LIKE')}>{preference.stance === 'LIKE' ? 'Dislike' : 'Like'}</button>
                  <button className="btn" onClick={() => void mutatePreference('mutation Mute($topicId: ID!) { mutePreference(topicId: $topicId) { topicId } }', preference.topicId)}>Mute</button>
                  <button className="btn" onClick={() => void mutatePreference('mutation Delete($topicId: ID!) { deletePreference(topicId: $topicId) { deleted } }', preference.topicId)}>Delete</button>
                </div>
              </div>
            ))}
            <button className="btn" onClick={() => {
              if (window.confirm('Erase the complete private preference profile?')) {
                void graphQl('mutation Erase { deleteMyPreferenceProfile { deleted } }').then(refresh);
              }
            }}>Erase preference profile</button>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header"><h2>Knowledge gaps</h2></div>
          <div className="panel-body state-list">
            {gaps.length === 0 && <p className="subtext">No assessed concept evidence yet.</p>}
            {gaps.map(gap => (
              <div className="state-row" key={gap.conceptId}>
                <div><strong>{gap.conceptId.replace('concept:v1:', '').replaceAll('-', ' ')}</strong><p>{gap.evidenceCount} evidence events · {gap.decisionSource}</p></div>
                <div className="gap-meter" aria-label={`${Math.round(gap.mastery * 100)} percent mastery`}>
                  <span style={{ width: `${Math.round(gap.mastery * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
