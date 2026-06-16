import { describe, expect, it, vi } from 'vitest';

const { getServiceByIdMock, supabaseFromMock } = vi.hoisted(() => ({
  getServiceByIdMock: vi.fn(),
  supabaseFromMock: vi.fn(),
}));

vi.mock('../src/lib/catalog', () => ({
  getServiceById: getServiceByIdMock,
}));

vi.mock('../src/db/supabaseClient', () => ({
  supabase: {
    from: supabaseFromMock,
  },
}));

import { checkPreBookingRequirements } from '../src/agent/gateChecker';

const t3Service = {
  id: 's-007',
  name: 'Profhilo',
  serviceTier: 'T3' as const,
  gateCategory: 'injectables',
};

function mockScreeningQuery(data: Record<string, unknown> | null) {
  supabaseFromMock.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
          }),
        }),
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
              }),
            }),
          }),
        }),
      }),
      in: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
            }),
          }),
        }),
      }),
    }),
  });
}

describe('checkPreBookingRequirements', () => {
  it('clears the gate for visitors with an approved screening on file', async () => {
    getServiceByIdMock.mockResolvedValue(t3Service);
    mockScreeningQuery({
      status: 'APPROVED',
      approved_until: '2026-12-31T00:00:00.000Z',
      service_category: 'injectables',
    });

    const result = await checkPreBookingRequirements('s-007', null, {
      visitorContact: '+123456789',
    });

    expect(result).toEqual({ gateCleared: true });
  });

  it('requires screening when no visitor screening exists', async () => {
    getServiceByIdMock.mockResolvedValue(t3Service);
    mockScreeningQuery(null);

    const result = await checkPreBookingRequirements('s-007', null, {
      visitorContact: '+123456789',
    });

    expect(result).toEqual({ gateCleared: false, reason: 'medical_screening_required' });
  });

  it('blocks booking while screening is under review', async () => {
    getServiceByIdMock.mockResolvedValue(t3Service);
    mockScreeningQuery({
      status: 'FLAGGED',
      approved_until: null,
      service_category: 'injectables',
    });

    const result = await checkPreBookingRequirements('s-007', null, {
      visitorContact: '+123456789',
    });

    expect(result).toEqual({ gateCleared: false, reason: 'screening_under_review' });
  });
});
