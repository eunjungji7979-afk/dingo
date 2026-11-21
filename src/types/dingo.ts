export const MAX_ROOM_TITLE_LEN = 80;
export const MAX_NICKNAME_LEN = 24;
export const MAX_PASSWORD_LEN = 30;
export const MAX_GROUPS = 7;
export const MIN_GROUPS = 2;
export const DECK_SIZE = 16;

export type RoomStatus = 'LOBBY' | 'PLAYING' | 'ENDED';

export type GroupPhase = 'LOBBY' | 'VIEWING' | 'DISCARDING' | 'PICKING' | 'DINGO_WON';

export interface Room {
  roomCode: string;
  title: string;
  teacherUid: string;
  totalGroups: number;
  status: RoomStatus;
  cardCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DingoCard {
  roomId: string;
  teacherUid: string;
  index: number;
  label: string;
  groupTag: number;
  imageDataUrl: string;
  createdAt?: unknown;
}

export interface SlicedCardDraft {
  index: number;
  label: string;
  groupTag: number;
  imageDataUrl: string;
}

export interface DingoGroup {
  roomId: string;
  teacherUid: string;
  groupNumber: number;
  roundNumber: number;
  phase: GroupPhase;
  hostPlayerId: string;
  hostIndex: number;
  activePlayerIds: string[];
  centerCardIds: number[];
  centerClaimedBy: string[];
  winnerId: string;
  winnerNickname: string;
  winningHand: number[];
  updatedAt?: unknown;
}

export interface GroupPlayer {
  id: string;
  uid: string;
  roomId: string;
  groupNumber: number;
  isBot: boolean;
  nickname: string;
  seatOrder: number;
  handCount: number;
  hasDiscarded: boolean;
  updatedAt?: unknown;
}

export interface PlayerHand {
  roomId: string;
  teacherUid: string;
  groupNumber: number;
  playerId: string;
  hand: number[];
  updatedAt?: unknown;
}

export interface DiscardSlot {
  roomId: string;
  teacherUid: string;
  groupNumber: number;
  playerId: string;
  cardIndex: number;
  updatedAt?: unknown;
}
