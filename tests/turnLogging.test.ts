import { describe, expect, it } from 'vitest';
import { extractEntitiesFromToolCalls, inferIntentFromToolCalls } from '../src/agent/turnLogging';

describe('turnLogging', () => {
  it('maps primary tool calls to intents', () => {
    expect(inferIntentFromToolCalls([{ name: 'search_availability' }])).toBe('check_availability');
    expect(inferIntentFromToolCalls([{ name: 'create_booking' }])).toBe('create_booking');
    expect(inferIntentFromToolCalls([{ name: 'escalate_human' }])).toBe('escalate_human');
    expect(inferIntentFromToolCalls([])).toBe('greeting_smalltalk');
  });

  it('uses the first recognized tool when multiple tools run', () => {
    expect(
      inferIntentFromToolCalls([
        { name: 'list_services' },
        { name: 'search_availability' },
      ]),
    ).toBe('faq_general');
  });

  it('extracts entities from tool arguments', () => {
    expect(
      extractEntitiesFromToolCalls([
        {
          name: 'search_availability',
          args: {
            service: 'svc-brow-lamination',
            branch: 'br-dxb',
            date: '2026-06-20',
          },
        },
      ]),
    ).toEqual({
      service: 'svc-brow-lamination',
      branch: 'br-dxb',
      date: '2026-06-20',
    });
  });
});
