import * as anki from './service'
import { ankiHealth } from './anki'
import {
  answerOwnedCard, collectionExists, getOwnedCards, getOwnedDashboard,
  getOwnedDeckProfile, getOwnedLessonSession, getOwnedReviewSession,
  getOwnedSettings, listOwnedDecks, ownedHealth, ownedMedia, updateOwnedSettings,
} from './owned'

export const listDecks = () => collectionExists() ? listOwnedDecks() : anki.listDecks()
export const getDeckProfile = (deck: string) => collectionExists() ? getOwnedDeckProfile(deck) : anki.getDeckProfile(deck)
export const getDashboard = (deck: string, config: Parameters<typeof anki.getDashboard>[1]) => collectionExists() ? getOwnedDashboard(deck, config) : anki.getDashboard(deck, config)
export const getReviewSession = (deck: string, config: Parameters<typeof anki.getReviewSession>[1]) => collectionExists() ? getOwnedReviewSession(deck, config) : anki.getReviewSession(deck, config)
export const getLessonSession = (deck: string, config: Parameters<typeof anki.getLessonSession>[1]) => collectionExists() ? getOwnedLessonSession(deck, config) : anki.getLessonSession(deck, config)
export const getCards = (ids: number[], deck: string, config: Parameters<typeof anki.getCards>[2]) => collectionExists() ? getOwnedCards(ids, deck, config) : anki.getCards(ids, deck, config)
export const answerCard = (id: number, ease: 1 | 3, requestId?: string) => collectionExists() ? answerOwnedCard(id, ease, requestId) : anki.answerCard(id, ease, requestId)
export const mediaFile = (filename: string) => collectionExists() ? ownedMedia(filename) : anki.mediaFile(filename)
export const providerHealth = () => collectionExists() ? ownedHealth() : ankiHealth()
export const getSettings = (deck: string) => {
  if (!collectionExists()) throw new Error('Migrate the collection before changing scheduling settings.')
  return getOwnedSettings(deck)
}
export const updateSettings = (deck: string, value: Parameters<typeof updateOwnedSettings>[1]) => {
  if (!collectionExists()) throw new Error('Migrate the collection before changing scheduling settings.')
  return updateOwnedSettings(deck, value)
}
