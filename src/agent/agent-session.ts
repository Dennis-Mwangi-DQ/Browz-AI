import type { AgentContextSnapshot, SessionContext } from '../types';

const MAX_TOPIC_ENTRIES = 8;

function mergeTopics(existing: string[] | undefined, additions: string[]): string[] {
  const merged = [...(existing ?? []), ...additions];
  return [...new Set(merged)].slice(-MAX_TOPIC_ENTRIES);
}

export function getContextSnapshot(session: SessionContext): AgentContextSnapshot {
  return session.agentContext ?? {};
}

export function learnFromToolCalls(
  snapshot: AgentContextSnapshot,
  toolCalls: { name: string; args: Record<string, unknown> }[],
): AgentContextSnapshot {
  const next: AgentContextSnapshot = { ...snapshot };
  const topics: string[] = [];

  for (const tc of toolCalls) {
    topics.push(tc.name);

    const args = tc.args ?? {};
    if (typeof args.service === 'string') {
      next.lastService = args.service;
    }
    if (typeof args.branch === 'string') {
      next.lastBranch = args.branch;
    }
    if (typeof args.bookingReference === 'string') {
      next.lastBookingRef = args.bookingReference;
    }
    if (tc.name === 'create_booking' || tc.name === 'modify_booking') {
      topics.push('bookings');
    }
    if (tc.name === 'search_availability') {
      topics.push('availability');
    }
    if (tc.name === 'list_services') {
      topics.push('services');
    }
  }

  next.recentTopics = mergeTopics(next.recentTopics, topics);
  return next;
}

export function formatContextForPrompt(
  snapshot: AgentContextSnapshot,
): string | null {
  const lines: string[] = [];

  if (snapshot.lastService) {
    lines.push(`Service in focus: ${snapshot.lastService}`);
  }
  if (snapshot.lastBranch) {
    lines.push(`Branch in focus: ${snapshot.lastBranch}`);
  }
  if (snapshot.lastBookingRef) {
    lines.push(`Booking reference in focus: ${snapshot.lastBookingRef}`);
  }
  if (snapshot.recentTopics?.length) {
    lines.push(`Recent topics: ${snapshot.recentTopics.join(', ')}`);
  }

  if (lines.length === 0) {
    return null;
  }
  return lines.join('\n');
}
