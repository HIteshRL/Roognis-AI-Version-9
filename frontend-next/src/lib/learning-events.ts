'use client';

import { LearningEventQueue, type LearningEventInput } from '@roognis/learning-events';

let queue: LearningEventQueue | null = null;

export function learningEvents(): LearningEventQueue {
  if (!queue) {
    queue = new LearningEventQueue();
    void queue.start();
  }
  return queue;
}

/** Assessment answer text is intentionally absent from this interface. */
export function captureAcademicInteraction(input: Omit<LearningEventInput, 'clientTsMono'>): void {
  void learningEvents().enqueue({ ...input, clientTsMono: performance.now() });
}

export const assessmentTelemetry = {
  rendered(item: { sessionId: string; itemId: string; conceptId: string; source: 'quiz' | 'written_answer' | 'practice' }) {
    captureAcademicInteraction({ ...item, eventType: 'item_rendered', payload: {} });
  },
  answerChanged(item: { sessionId: string; itemId: string; conceptId: string; source: 'quiz' | 'written_answer' | 'practice'; answerPresent: boolean }) {
    const { answerPresent, ...identity } = item;
    captureAcademicInteraction({ ...identity, eventType: 'answer_changed', payload: { answerPresent } });
  },
  flashcardRevealed(item: { sessionId: string; itemId: string; conceptId: string }) {
    captureAcademicInteraction({ ...item, source: 'flashcard', eventType: 'flashcard_revealed', payload: {} });
  },
};
