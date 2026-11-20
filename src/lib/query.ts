import { QueryClient, queryOptions } from '@tanstack/solid-query'
import { api } from './api'
import { loadCards } from './cards'
import type { SchedulingSettings, StudyConfig } from './domain'

export function createAppQueryClient() {
  return new QueryClient({defaultOptions:{
    queries:{
      retry:(failures,error)=>{
        const failure = error as {code?:string;status?:number}
        return failures<1 && (failure.code==='NETWORK' || failure.code==='TIMEOUT' || [502,503,504].includes(failure.status ?? 0))
      },
      retryDelay:250,
      staleTime:15_000,
      refetchOnWindowFocus:false,
    },
    mutations:{retry:false},
  }})
}

export const queryKeys = {
  health:['health'] as const,
  decks:['decks'] as const,
  profile:(deck:string)=>['profile',deck] as const,
  dashboard:(deck:string,config:unknown)=>['dashboard',deck,config] as const,
  dashboardDeck:(deck:string)=>['dashboard',deck] as const,
  settings:(deck:string)=>['settings',deck] as const,
  backups:['backups'] as const,
  lessons:(deck:string,config:unknown)=>['lessons',deck,config] as const,
  reviews:(deck:string,config:unknown)=>['reviews',deck,config] as const,
  cards:(deck:string,ids:number[],config:unknown)=>['cards',deck,ids,config] as const,
}

export const mutations = {
  updateSettings:(client:QueryClient,deck:string)=>({
    mutationFn:(value:SchedulingSettings)=>api.updateSettings(deck,value),
    onSuccess:()=>Promise.all([
      client.invalidateQueries({queryKey:queryKeys.settings(deck)}),
      client.invalidateQueries({queryKey:queryKeys.dashboardDeck(deck)}),
    ]),
  }),
  restoreBackup:()=>({mutationFn:(name:string)=>api.restoreBackup(name)}),
  importPackage:()=>({mutationFn:(file:File)=>api.importPackage(file)}),
  answer:(client:QueryClient,deck:string)=>({
    mutationFn:(input:{cardId:number;ease:1|3;requestId:string})=>api.answer(input.cardId,input.ease,input.requestId),
    onSuccess:()=>client.invalidateQueries({queryKey:queryKeys.dashboardDeck(deck)}),
  }),
}

export const queries = {
  health:()=>queryOptions({queryKey:queryKeys.health,queryFn:({signal})=>api.health(signal),staleTime:0}),
  decks:()=>queryOptions({queryKey:queryKeys.decks,queryFn:({signal})=>api.decks(signal),staleTime:0}),
  profile:(deck:string)=>queryOptions({queryKey:queryKeys.profile(deck),queryFn:({signal})=>api.profile(deck,signal)}),
  dashboard:(deck:string,config:StudyConfig|null,enabled=true)=>queryOptions({queryKey:queryKeys.dashboard(deck,config),queryFn:({signal})=>api.dashboard(deck,config!,signal),enabled:enabled&&Boolean(deck&&config)}),
  settings:(deck:string)=>queryOptions({queryKey:queryKeys.settings(deck),queryFn:({signal})=>api.settings(deck,signal)}),
  backups:()=>queryOptions({queryKey:queryKeys.backups,queryFn:({signal})=>api.backups(signal)}),
  lessons:(deck:string,config:StudyConfig)=>queryOptions({queryKey:queryKeys.lessons(deck,config),queryFn:({signal})=>api.lessons(deck,config,signal),staleTime:0}),
  reviews:(deck:string,config:StudyConfig)=>queryOptions({queryKey:queryKeys.reviews(deck,config),queryFn:({signal})=>api.reviews(deck,config,signal),staleTime:0}),
  cards:(deck:string,ids:number[],config:StudyConfig)=>queryOptions({queryKey:queryKeys.cards(deck,ids,config),queryFn:({signal})=>loadCards(deck,ids,config,signal)}),
}
