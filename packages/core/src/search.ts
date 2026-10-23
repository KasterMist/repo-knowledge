import type { Card } from './schema.js';

const normalize = (text: string) => text.normalize('NFKC').toLowerCase();
export function rankCards(cards: Card[], query: string, limit: number) {
  const phrase = normalize(query).trim();
  const parts = normalize(query.replace(/([a-z])([A-Z])/gu, '$1 $2'));
  const terms = [
    ...new Set([
      ...phrase.split(/\s+/u),
      ...(parts.match(/[a-z0-9_$]+|[\p{Script=Han}]+/gu) ?? []),
    ]),
  ]
    .filter(Boolean)
    .slice(0, 24);
  return cards
    .map((card) => {
      const fields = [
        [normalize(card.id), 12],
        [normalize(card.title), 12],
        [normalize(card.tags.join(' ')), 10],
        [
          normalize(
            card.scope.join(' ') +
              ' ' +
              card.evidence.map((e) => e.path).join(' '),
          ),
          4,
        ],
        [normalize(card.body), 3],
      ] as const;
      let matches = 0;
      let score = 0;
      for (const term of terms) {
        let matched = false;
        for (const [text, weight] of fields)
          if (text.includes(term)) {
            score += weight;
            matched = true;
          }
        if (matched) matches++;
      }
      if (matches) {
        score += (50 * matches) / terms.length;
        if (
          normalize(card.title).includes(phrase) ||
          normalize(card.id) === phrase
        )
          score += 25;
      }
      return {
        id: card.id,
        title: card.title,
        revision: card.revision,
        kind: card.kind,
        score,
      };
    })
    .filter((card) => card.score > 0)
    .sort(
      (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, limit);
}
