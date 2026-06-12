import { dispatchReminders } from './dispatchReminders';
import { processNoShowRisk } from './processNoShowRisk';
import { processNoShows } from './processNoShows';
import { getEnv } from '../lib/env';

type JobHandle = ReturnType<typeof setInterval>;

const handles: JobHandle[] = [];

function schedule(name: string, intervalMs: number, job: () => Promise<unknown>): void {
  const handle = setInterval(() => {
    void job().catch((error) => {
      console.error(`[scheduled-job:${name}] failed`, error);
    });
  }, intervalMs);
  handles.push(handle);
}

export function startScheduledJobs(): void {
  const env = getEnv();
  if (!env.ENABLE_SCHEDULED_JOBS || env.NODE_ENV === 'test' || handles.length > 0) {
    return;
  }

  schedule('dispatchReminders', env.REMINDER_JOB_INTERVAL_MS, () => dispatchReminders());
  schedule('processNoShowRisk', env.NO_SHOW_RISK_JOB_INTERVAL_MS, () => processNoShowRisk());
  schedule('processNoShows', env.NO_SHOW_JOB_INTERVAL_MS, () => processNoShows());
}

export function stopScheduledJobs(): void {
  for (const handle of handles.splice(0)) {
    clearInterval(handle);
  }
}
