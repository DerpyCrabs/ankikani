import { Effect } from 'effect'
import { api } from './api'
import type { StudyCard, StudyConfig } from './domain'

export const loadCards = Effect.fn('loadCards')(function* (
  deckName: string,
  cardIds: number[],
  configuration: StudyConfig,
) {
  const cards: StudyCard[] = []
  for (let offset = 0; offset < cardIds.length; offset += 500) {
    cards.push(...(yield* api.cards(deckName, cardIds.slice(offset, offset + 500), configuration)))
  }
  return cards
})
