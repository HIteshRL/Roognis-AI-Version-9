export type LearningEventType =
  | 'item_rendered'
  | 'first_interaction'
  | 'answer_changed'
  | 'answer_submitted'
  | 'item_skipped'
  | 'hint_requested'
  | 'confidence_reported'
  | 'focus_lost'
  | 'focus_gained'
  | 'written_answer_scored'
  | 'flashcard_revealed'
  | 'flashcard_review_completed';

export type LearningEventSource = 'quiz' | 'written_answer' | 'flashcard' | 'practice';

export interface LearningEventInput {
  eventId?: string;
  eventType: LearningEventType;
  source: LearningEventSource;
  sessionId?: string | null;
  itemId?: string | null;
  conceptId?: string | null;
  clientTsMono?: number;
  clientTsWall?: string | Date;
  payload?: Record<string, unknown>;
}

export interface LearningEventEnvelope extends LearningEventInput {
  schemaVersion: 1;
  eventId: string;
  sessionId: string | null;
  itemId: string | null;
  conceptId: string | null;
  clientTsMono: number;
  clientTsWall: string;
  payload: Record<string, unknown>;
}

export interface LearningEventQueueOptions {
  endpoint?: string;
  dbName?: string;
  storeName?: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

export declare const SCHEMA_VERSION: 1;
export declare const EVENT_TYPES: readonly LearningEventType[];
export declare const EVENT_SOURCES: readonly LearningEventSource[];
export declare function createLearningEvent(input: LearningEventInput): LearningEventEnvelope;

export declare class LearningEventQueue {
  constructor(options?: LearningEventQueueOptions);
  start(): Promise<this>;
  stop(): void;
  enqueue(input: LearningEventInput): Promise<LearningEventEnvelope>;
  flush(options?: { keepalive?: boolean }): Promise<Record<string, unknown>>;
}
