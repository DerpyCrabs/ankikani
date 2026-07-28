import { api } from './api'
import type { StudyCard, StudyConfig } from './domain'

export async function loadCards(
  deckName: string,
  cardIds: number[],
  configuration: StudyConfig,
): Promise<StudyCard[]> {
  const cards: StudyCard[] = []
  for (let offset = 0; offset < cardIds.length; offset += 500) {
    cards.push(
      ...(await api.cards(
        deckName,
        cardIds.slice(offset, offset + 500),
        configuration,
      )),
    )
  }
  return cards
}
