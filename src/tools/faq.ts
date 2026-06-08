import { z } from 'zod';
import { supabase } from '../db/supabaseClient';
import { generateQueryEmbedding } from '../lib/embeddings';
import { fail, ok } from '../lib/result';
import type { ToolResult } from '../types';

const FaqParams = z.object({
  query: z.string().min(1),
});

export async function lookupFaq(params: {
  query: string;
}): Promise<ToolResult<{ answer: string; category: string }>> {
  const parsed = FaqParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_faq_params');
  }

  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const embedding = await generateQueryEmbedding(params.query);
    if (embedding) {
      const { data, error } = await supabase.rpc('match_faqs', {
        query_embedding: embedding,
        match_threshold: 0.72,
        match_count: 1,
      });

      if (!error && data && data.length > 0) {
        const match = data[0] as { answer?: string; category?: string };
        if (match.answer) {
          return ok({
            answer: String(match.answer),
            category: String(match.category ?? 'general'),
          });
        }
      }
    }

    const { data, error } = await supabase
      .from('faqs')
      .select('answer, category, question')
      .limit(25);

    if (error) {
      console.error('lookupFaq failed', error);
      return fail('faq_lookup_failed');
    }

    const normalizedQuery = params.query.toLowerCase();
    const match = data?.find((item) => {
      const question = String(item.question ?? '').toLowerCase();
      return (
        question.includes(normalizedQuery) ||
        normalizedQuery.includes(question) ||
        normalizedQuery.includes(String(item.category ?? '').toLowerCase())
      );
    });

    if (match?.answer) {
      return ok({
        answer: String(match.answer),
        category: String(match.category ?? 'general'),
      });
    }

    return fail('no_faq_match');
  } catch (error) {
    console.error('lookupFaq failed', error);
    return fail('faq_lookup_failed');
  }
}
