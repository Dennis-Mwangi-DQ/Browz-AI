import 'dotenv/config';
import { generateEmbedding } from '../src/lib/embeddings';
import { requireSeedClient } from './shared';

async function main() {
  const supabase = requireSeedClient();
  const { data: faqs, error } = await supabase
    .from('faqs')
    .select('id, question, answer')
    .is('embedding', null);

  if (error) {
    throw new Error(error.message);
  }

  if (!faqs || faqs.length === 0) {
    console.log('All FAQs already have embeddings.');
    return;
  }

  console.log(`Generating embeddings for ${faqs.length} FAQ records...`);

  for (const faq of faqs) {
    const text = `${faq.question}\n${faq.answer}`;
    const embedding = await generateEmbedding(text);

    const { error: updateError } = await supabase
      .from('faqs')
      .update({ embedding })
      .eq('id', faq.id);

    if (updateError) {
      console.error(`Failed to update FAQ ${faq.id}:`, updateError.message);
    } else {
      console.log(`Embedded: ${String(faq.question).slice(0, 60)}...`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('All FAQ embeddings generated successfully.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
