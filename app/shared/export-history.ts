import type { ExportOptions, Job } from './types.js';

/** Public durable export receipt. The immutable project and source paths stay on disk. */
export interface ExportRecord extends Job {
  projectId: string;
  projectName: string;
  projectRevision: string;
  snapshotCreatedAt: string;
  options: ExportOptions;
  updatedAt: string;
  revision: number;
  restartOf?: string;
  restartedAs?: string;
  output: { status: 'pending' | 'available' | 'missing' | 'changed' | 'unreadable'; reason?: string };
  recovery: { status: 'available' | 'blocked'; reason?: string; runtimeChanged: boolean; changedSources?: string[] };
}
