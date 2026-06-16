import { describe, expect, it, vi } from 'vitest';

const { supabaseFromMock } = vi.hoisted(() => ({
  supabaseFromMock: vi.fn(),
}));

vi.mock('../src/db/supabaseClient', () => ({
  supabase: {
    from: supabaseFromMock,
  },
}));

vi.mock('../src/lib/catalog', () => ({
  findServiceByName: vi.fn(async (name: string) =>
    name === 'HD Brows'
      ? {
          id: 's-001',
          name: 'HD Brows',
          category: 'Brows',
          serviceTier: 'T1',
          gateCategory: 'brows',
          city: null,
          durationMinutes: 60,
          priceAed: 290,
          requiresConsultation: false,
          requiresPatchTest: false,
          requiresScreening: false,
          isMedicalGated: false,
          minFrequencyWeeks: null,
          frequencyHardBlock: false,
          description: '',
        }
      : null,
  ),
  findBranchByName: vi.fn(),
}));

import { listBranchesForService } from '../src/tools/services';

describe('listBranchesForService', () => {
  it('includes busy branches that offer the service', async () => {
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'artists') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ branch_id: 'br-dxb', service_ids: ['s-001'] }],
              error: null,
            }),
          }),
        };
      }

      if (table === 'time_slots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        };
      }

      if (table === 'branches') {
        return {
          select: vi.fn().mockReturnValue({
            neq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'br-dxb',
                    name: 'Browz 1',
                    city: 'Umm Suqeim',
                    address: 'Al Wasl Road',
                    status: 'busy',
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await listBranchesForService({ service: 'HD Brows' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      {
        id: 'br-dxb',
        name: 'Browz 1',
        city: 'Umm Suqeim',
        address: 'Al Wasl Road',
      },
    ]);
  });
});
