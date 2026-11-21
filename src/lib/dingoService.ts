import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  DECK_SIZE,
  MAX_GROUPS,
  MAX_NICKNAME_LEN,
  MAX_PASSWORD_LEN,
  MAX_ROOM_TITLE_LEN,
  MIN_GROUPS,
  type DingoCard,
  type DingoGroup,
  type DiscardSlot,
  type GroupPlayer,
  type PlayerHand,
  type Room,
  type SlicedCardDraft,
} from '../types/dingo';

export async function hashRoomPassword(roomCode: string, password: string): Promise<string> {
  const normalized = `${roomCode.trim().toUpperCase()}:${password.trim()}`;
  const bytes = new TextEncoder().encode(normalized);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Deterministic 64-char hex fallback if crypto.subtle is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= bytes[i] + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return (part1 + part2).repeat(4);
}

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function sanitizeTitle(title: string): string {
  const trimmed = title.trim();
  return (trimmed || '우리 반 딩고 게임').slice(0, MAX_ROOM_TITLE_LEN);
}

function sanitizeNickname(nickname: string): string {
  return nickname.trim().slice(0, MAX_NICKNAME_LEN);
}

function computeDealForPlayers(players: GroupPlayer[], hostIndex: number) {
  const sorted = [...players].sort((a, b) => a.seatOrder - b.seatOrder);
  const safeHostIdx = sorted.length > 0 ? hostIndex % sorted.length : 0;
  const hostPlayer = sorted[safeHostIdx];
  const deck = shuffleArray(Array.from({ length: DECK_SIZE }, (_, i) => i));

  // 5-player rule: 1 non-playing host (0 cards) + 4 players holding 4 cards each (16 cards total)
  const isFivePlayerMode = sorted.length === 5;
  const activePlayers = isFivePlayerMode
    ? sorted.filter((_, idx) => idx !== safeHostIdx)
    : sorted;

  const handsByPlayerId: Record<string, number[]> = {};
  let cursor = 0;
  for (const p of sorted) {
    if (isFivePlayerMode && p.id === hostPlayer.id) {
      handsByPlayerId[p.id] = [];
    } else {
      handsByPlayerId[p.id] = deck.slice(cursor, cursor + 4);
      cursor += 4;
    }
  }

  return {
    hostPlayerId: hostPlayer?.id ?? '',
    hostIndex: safeHostIdx,
    activePlayerIds: activePlayers.map((p) => p.id),
    handsByPlayerId,
  };
}

export async function createRoom(
  teacherUid: string,
  title: string,
  totalGroups: number,
  joinPassword: string,
  cards: SlicedCardDraft[]
): Promise<string> {
  if (cards.length !== DECK_SIZE) {
    throw new Error('딩고 카드는 정확히 16장이어야 합니다.');
  }
  const cleanPassword = joinPassword.trim().slice(0, MAX_PASSWORD_LEN);
  if (!cleanPassword) {
    throw new Error('학생 입장 비밀번호를 입력해 주세요.');
  }
  const safeGroups = Math.max(MIN_GROUPS, Math.min(MAX_GROUPS, Math.floor(totalGroups)));
  const safeTitle = sanitizeTitle(title);

  // Pick a unique room code
  let roomCode = generateRoomCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await getDoc(doc(db, 'rooms', roomCode));
    if (!existing.exists()) break;
    roomCode = generateRoomCode();
  }

  const passHash = await hashRoomPassword(roomCode, cleanPassword);
  const roomPath = `rooms/${roomCode}`;
  try {
    await setDoc(doc(db, 'rooms', roomCode), {
      roomCode,
      title: safeTitle,
      teacherUid,
      totalGroups: safeGroups,
      status: 'LOBBY',
      cardCount: DECK_SIZE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, roomPath);
  }

  const batch = writeBatch(db);
  batch.set(doc(db, 'rooms', roomCode, 'passes', passHash), {
    roomId: roomCode,
    teacherUid,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'rooms', roomCode, 'teacherSecret', 'info'), {
    roomId: roomCode,
    teacherUid,
    joinPassword: cleanPassword,
    updatedAt: serverTimestamp(),
  });

  cards.forEach((card, idx) => {
    const cardRef = doc(db, 'rooms', roomCode, 'cards', String(idx));
    batch.set(cardRef, {
      roomId: roomCode,
      teacherUid,
      index: idx,
      label: card.label.trim().slice(0, 60) || `카드 ${idx + 1}`,
      groupTag: Math.max(1, Math.min(4, card.groupTag)),
      imageDataUrl: card.imageDataUrl.slice(0, 350000),
      createdAt: serverTimestamp(),
    });
  });

  for (let g = 1; g <= safeGroups; g++) {
    const groupRef = doc(db, 'rooms', roomCode, 'groups', String(g));
    batch.set(groupRef, {
      roomId: roomCode,
      teacherUid,
      groupNumber: g,
      roundNumber: 0,
      phase: 'LOBBY',
      hostPlayerId: '',
      hostIndex: 0,
      activePlayerIds: [],
      centerCardIds: [],
      centerClaimedBy: [],
      winnerId: '',
      winnerNickname: '',
      winningHand: [],
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${roomPath}/setup`);
  }

  return roomCode;
}

export async function verifyRoomPassword(roomCode: string, password: string): Promise<boolean> {
  const cleanCode = roomCode.trim().toUpperCase();
  const cleanPassword = password.trim();
  if (!cleanCode || !cleanPassword) return false;
  const passHash = await hashRoomPassword(cleanCode, cleanPassword);
  const path = `rooms/${cleanCode}/passes/${passHash}`;
  try {
    const snap = await getDoc(doc(db, 'rooms', cleanCode, 'passes', passHash));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchTeacherRoomPassword(roomCode: string): Promise<string | null> {
  const path = `rooms/${roomCode}/teacherSecret/info`;
  try {
    const snap = await getDoc(doc(db, 'rooms', roomCode, 'teacherSecret', 'info'));
    if (!snap.exists()) return null;
    return (snap.data() as { joinPassword?: string }).joinPassword ?? null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getRoom(roomCode: string): Promise<Room | null> {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(cleanCode)) return null;
  const path = `rooms/${cleanCode}`;
  try {
    const snap = await getDoc(doc(db, 'rooms', cleanCode));
    if (!snap.exists()) return null;
    return snap.data() as Room;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchRoomCards(roomCode: string): Promise<DingoCard[]> {
  const path = `rooms/${roomCode}/cards`;
  try {
    const snaps = await Promise.all(
      Array.from({ length: DECK_SIZE }, (_, idx) =>
        getDoc(doc(db, 'rooms', roomCode, 'cards', String(idx)))
      )
    );
    return snaps
      .filter((s) => s.exists())
      .map((s) => s.data() as DingoCard)
      .sort((a, b) => a.index - b.index);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeTeacherRooms(
  teacherUid: string,
  onChange: (rooms: Room[]) => void
) {
  const path = 'rooms';
  const q = query(collection(db, 'rooms'), where('teacherUid', '==', teacherUid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as Room);
      list.sort((a, b) => {
        const at = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
        const bt = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
        return bt - at;
      });
      onChange(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeRoom(roomCode: string, onChange: (room: Room | null) => void) {
  const path = `rooms/${roomCode}`;
  return onSnapshot(
    doc(db, 'rooms', roomCode),
    (snap) => {
      onChange(snap.exists() ? (snap.data() as Room) : null);
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export function subscribeRoomGroups(
  roomCode: string,
  onChange: (groups: DingoGroup[]) => void
) {
  const path = `rooms/${roomCode}/groups`;
  const q = query(collection(db, 'rooms', roomCode, 'groups'), where('roomId', '==', roomCode));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as DingoGroup);
      list.sort((a, b) => a.groupNumber - b.groupNumber);
      onChange(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeGroupPlayers(
  roomCode: string,
  groupNumber: number,
  onChange: (players: GroupPlayer[]) => void
) {
  const path = `rooms/${roomCode}/groups/${groupNumber}/players`;
  const q = query(
    collection(db, 'rooms', roomCode, 'groups', String(groupNumber), 'players'),
    where('roomId', '==', roomCode)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => ({
        ...(d.data() as Omit<GroupPlayer, 'id'>),
        id: d.id,
      }));
      list.sort((a, b) => a.seatOrder - b.seatOrder);
      onChange(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}
export function subscribePlayerHand(
  roomCode: string,
  groupNumber: number,
  playerId: string,
  onChange: (hand: number[]) => void
) {
  const path = `rooms/${roomCode}/groups/${groupNumber}/playerHands/${playerId}`;
  return onSnapshot(
    doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'playerHands', playerId),
    (snap) => {
      if (!snap.exists()) {
        onChange([]);
        return;
      }
      const data = snap.data() as PlayerHand;
      onChange(Array.isArray(data.hand) ? data.hand : []);
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export async function fetchPlayerHand(
  roomCode: string,
  groupNumber: number,
  playerId: string
): Promise<number[]> {
  const path = `rooms/${roomCode}/groups/${groupNumber}/playerHands/${playerId}`;
  try {
    const snap = await getDoc(
      doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'playerHands', playerId)
    );
    if (!snap.exists()) return [];
    const data = snap.data() as PlayerHand;
    return Array.isArray(data.hand) ? data.hand : [];
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}
export async function joinGroup(
  roomCode: string,
  groupNumber: number,
  uid: string,
  nickname: string
): Promise<void> {
  const cleanName = sanitizeNickname(nickname);
  if (!cleanName) {
    throw new Error('닉네임을 입력해 주세요.');
  }

  const playersCol = collection(db, 'rooms', roomCode, 'groups', String(groupNumber), 'players');
  const colPath = `rooms/${roomCode}/groups/${groupNumber}/players`;
  const docPath = `${colPath}/${uid}`;

  let existingSnap;
  try {
    existingSnap = await getDocs(query(playersCol, where('roomId', '==', roomCode)));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }

  const alreadyInGroup = existingSnap.docs.some((d) => d.id === uid);
  if (!alreadyInGroup && existingSnap.size >= 5) {
    throw new Error(`${groupNumber}모둠은 최대 5명까지 입장할 수 있습니다.`);
  }

  const playerRef = doc(playersCol, uid);
  if (alreadyInGroup) {
    try {
      const groupSnap = await getDoc(doc(db, 'rooms', roomCode, 'groups', String(groupNumber)));
      const phase = groupSnap.exists() ? (groupSnap.data() as DingoGroup).phase : 'LOBBY';
      if (phase === 'LOBBY') {
        await updateDoc(playerRef, {
          nickname: cleanName,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, docPath);
    }
    return;
  }

  try {
    await setDoc(playerRef, {
      uid,
      roomId: roomCode,
      groupNumber,
      isBot: false,
      nickname: cleanName,
      seatOrder: Date.now(),
      handCount: 0,
      hasDiscarded: false,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function addPracticeBots(
  roomCode: string,
  groupNumber: number,
  teacherUid: string,
  targetSize: number
): Promise<void> {
  const playersCol = collection(db, 'rooms', roomCode, 'groups', String(groupNumber), 'players');
  const path = `rooms/${roomCode}/groups/${groupNumber}/players`;
  const botNames = ['연습생 가온', '연습생 나래', '연습생 다온', '연습생 라온', '연습생 마루'];

  try {
    const snap = await getDocs(query(playersCol, where('roomId', '==', roomCode)));
    const currentCount = snap.size;
    const needed = Math.max(0, Math.min(5, targetSize) - currentCount);
    if (needed === 0) return;

    const batch = writeBatch(db);
    for (let i = 0; i < needed; i++) {
      const idx = currentCount + i;
      const botId = `bot_${groupNumber}_${Date.now()}_${i}`;
      batch.set(doc(playersCol, botId), {
        uid: teacherUid,
        roomId: roomCode,
        groupNumber,
        isBot: true,
        nickname: botNames[idx % botNames.length],
        seatOrder: Date.now() + i + 1,
        handCount: 0,
        hasDiscarded: false,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removePlayer(
  roomCode: string,
  groupNumber: number,
  playerId: string
): Promise<void> {
  const path = `rooms/${roomCode}/groups/${groupNumber}/players/${playerId}`;
  try {
    await deleteDoc(doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'players', playerId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function startGame(
  roomCode: string,
  groups: DingoGroup[],
  playersByGroup: Record<number, GroupPlayer[]>
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomCode), {
    status: 'PLAYING',
    updatedAt: serverTimestamp(),
  });

  for (const g of groups) {
    const groupPlayers = playersByGroup[g.groupNumber] ?? [];
    if (groupPlayers.length === 0) continue;

    const deal = computeDealForPlayers(groupPlayers, 0);
    batch.update(doc(db, 'rooms', roomCode, 'groups', String(g.groupNumber)), {
      roundNumber: 1,
      phase: 'VIEWING',
      hostPlayerId: deal.hostPlayerId,
      hostIndex: deal.hostIndex,
      activePlayerIds: deal.activePlayerIds,
      centerCardIds: [],
      centerClaimedBy: [],
      winnerId: '',
      winnerNickname: '',
      winningHand: [],
      updatedAt: serverTimestamp(),
    });

    for (const p of groupPlayers) {
      const hand = deal.handsByPlayerId[p.id] ?? [];
      batch.update(
        doc(db, 'rooms', roomCode, 'groups', String(g.groupNumber), 'players', p.id),
        {
          handCount: hand.length,
          hasDiscarded: false,
          updatedAt: serverTimestamp(),
        }
      );
      batch.set(
        doc(db, 'rooms', roomCode, 'groups', String(g.groupNumber), 'playerHands', p.id),
        {
          roomId: roomCode,
          teacherUid: g.teacherUid,
          groupNumber: g.groupNumber,
          playerId: p.id,
          hand,
          updatedAt: serverTimestamp(),
        }
      );
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `rooms/${roomCode}/start`);
  }
}

export async function triggerDiscardCommand(roomCode: string, groupNumber: number): Promise<void> {
  const path = `rooms/${roomCode}/groups/${groupNumber}`;
  try {
    await updateDoc(doc(db, 'rooms', roomCode, 'groups', String(groupNumber)), {
      phase: 'DISCARDING',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function submitDiscardCard(
  roomCode: string,
  groupNumber: number,
  playerId: string,
  cardIndex: number
): Promise<void> {
  const playerRef = doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'players', playerId);
  const handRef = doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'playerHands', playerId);
  const discardSlotRef = doc(
    db,
    'rooms',
    roomCode,
    'groups',
    String(groupNumber),
    'discardSlots',
    playerId
  );
  const path = handRef.path;

  try {
    await runTransaction(db, async (tx) => {
      const [pSnap, hSnap] = await Promise.all([tx.get(playerRef), tx.get(handRef)]);
      if (!pSnap.exists() || !hSnap.exists()) {
        throw new Error('플레이어 또는 카드 정보를 찾을 수 없습니다.');
      }
      const playerData = pSnap.data() as Omit<GroupPlayer, 'id'>;
      const handData = hSnap.data() as PlayerHand;

      if (playerData.hasDiscarded) return; // already discarded this turn
      const idxPos = handData.hand.indexOf(cardIndex);
      if (idxPos === -1) throw new Error('선택한 카드가 손패에 없습니다.');

      const nextHand = [...handData.hand];
      nextHand.splice(idxPos, 1);

      tx.update(handRef, {
        hand: nextHand,
        updatedAt: serverTimestamp(),
      });

      tx.update(playerRef, {
        handCount: nextHand.length,
        hasDiscarded: true,
        updatedAt: serverTimestamp(),
      });

      tx.set(discardSlotRef, {
        roomId: roomCode,
        teacherUid: handData.teacherUid,
        groupNumber,
        playerId,
        cardIndex,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function triggerPickCommand(
  roomCode: string,
  groupNumber: number,
  activePlayerIds: string[]
): Promise<void> {
  const groupRef = doc(db, 'rooms', roomCode, 'groups', String(groupNumber));

  let slotSnaps;
  try {
    slotSnaps = await Promise.all(
      activePlayerIds.map((pid) =>
        getDoc(doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'discardSlots', pid))
      )
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `rooms/${roomCode}/groups/${groupNumber}/discardSlots`);
  }

  if (slotSnaps.some((s) => !s.exists())) {
    throw new Error('모든 플레이어가 카드를 버린 후 집어!를 누를 수 있습니다.');
  }

  const discardedCards = slotSnaps.map((s) => (s.data() as DiscardSlot).cardIndex);
  const shuffledCenter = shuffleArray(discardedCards);
  const emptyClaims = shuffledCenter.map(() => '');

  const batch = writeBatch(db);
  batch.update(groupRef, {
    phase: 'PICKING',
    centerCardIds: shuffledCenter,
    centerClaimedBy: emptyClaims,
    updatedAt: serverTimestamp(),
  });

  for (const pid of activePlayerIds) {
    batch.delete(doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'discardSlots', pid));
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, groupRef.path);
  }
}

export async function claimCenterSlot(
  roomCode: string,
  groupNumber: number,
  playerId: string,
  slotIndex: number
): Promise<{ alreadyClaimed?: boolean }> {
  const groupRef = doc(db, 'rooms', roomCode, 'groups', String(groupNumber));
  const playerRef = doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'players', playerId);
  const handRef = doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'playerHands', playerId);

  try {
    const result = await runTransaction(db, async (tx) => {
      const [gSnap, pSnap, hSnap] = await Promise.all([
        tx.get(groupRef),
        tx.get(playerRef),
        tx.get(handRef),
      ]);
      if (!gSnap.exists() || !pSnap.exists() || !hSnap.exists()) {
        throw new Error('게임 또는 플레이어 정보를 찾을 수 없습니다.');
      }

      const group = gSnap.data() as DingoGroup;
      const player = pSnap.data() as Omit<GroupPlayer, 'id'>;
      const handData = hSnap.data() as PlayerHand;

      if (group.phase !== 'PICKING') {
        throw new Error('현재 카드를 집는 단계가 아닙니다.');
      }
      if (!player.hasDiscarded || handData.hand.length >= 4) {
        throw new Error('이미 이번 차례의 카드를 가져갔습니다.');
      }
      if (group.centerClaimedBy[slotIndex] !== '') {
        return { alreadyClaimed: true };
      }

      const pickedCardId = group.centerCardIds[slotIndex];
      const nextClaimed = [...group.centerClaimedBy];
      nextClaimed[slotIndex] = playerId;
      const nextHand = [...handData.hand, pickedCardId];

      const allClaimed = nextClaimed.every((id) => id !== '');

      tx.update(groupRef, {
        centerClaimedBy: nextClaimed,
        phase: allClaimed ? 'VIEWING' : 'PICKING',
        updatedAt: serverTimestamp(),
      });

      tx.update(handRef, {
        hand: nextHand,
        updatedAt: serverTimestamp(),
      });

      tx.update(playerRef, {
        handCount: nextHand.length,
        hasDiscarded: false,
        updatedAt: serverTimestamp(),
      });

      return { alreadyClaimed: false };
    });
    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('현재 카드를') || error.message.includes('이미 이번'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, groupRef.path);
  }
}

export async function callDingo(
  roomCode: string,
  groupNumber: number,
  playerId: string,
  nickname: string,
  hand: number[]
): Promise<void> {
  if (hand.length !== 4) {
    throw new Error('카드 4장을 모두 가지고 있어야 딩고를 외칠 수 있습니다.');
  }
  const groupRef = doc(db, 'rooms', roomCode, 'groups', String(groupNumber));
  try {
    await updateDoc(groupRef, {
      phase: 'DINGO_WON',
      winnerId: playerId,
      winnerNickname: sanitizeNickname(nickname) || '우승자',
      winningHand: hand.slice(0, 4),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, groupRef.path);
  }
}

export async function startNextRoundForGroup(
  roomCode: string,
  groupNumber: number,
  currentGroup: DingoGroup,
  players: GroupPlayer[]
): Promise<void> {
  if (players.length === 0) return;
  const nextHostIndex = (currentGroup.hostIndex + 1) % players.length;
  const deal = computeDealForPlayers(players, nextHostIndex);

  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomCode, 'groups', String(groupNumber)), {
    roundNumber: currentGroup.roundNumber + 1,
    phase: 'VIEWING',
    hostPlayerId: deal.hostPlayerId,
    hostIndex: deal.hostIndex,
    activePlayerIds: deal.activePlayerIds,
    centerCardIds: [],
    centerClaimedBy: [],
    winnerId: '',
    winnerNickname: '',
    winningHand: [],
    updatedAt: serverTimestamp(),
  });

  for (const p of players) {
    const hand = deal.handsByPlayerId[p.id] ?? [];
    batch.update(
      doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'players', p.id),
      {
        handCount: hand.length,
        hasDiscarded: false,
        updatedAt: serverTimestamp(),
      }
    );
    batch.set(
      doc(db, 'rooms', roomCode, 'groups', String(groupNumber), 'playerHands', p.id),
      {
        roomId: roomCode,
        teacherUid: currentGroup.teacherUid,
        groupNumber,
        playerId: p.id,
        hand,
        updatedAt: serverTimestamp(),
      }
    );
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `rooms/${roomCode}/groups/${groupNumber}/next`);
  }
}

export async function endRoom(roomCode: string): Promise<void> {
  const path = `rooms/${roomCode}`;
  try {
    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'ENDED',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

async function commitDeleteRefs(refs: ReturnType<typeof doc>[], opPath: string): Promise<void> {
  const chunkSize = 400;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + chunkSize)) {
      batch.delete(ref);
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, opPath);
    }
  }
}

export async function deleteAllTeacherRooms(teacherUid: string): Promise<void> {
  const roomsPath = 'rooms';
  let roomSnaps;
  try {
    roomSnaps = await getDocs(
      query(collection(db, 'rooms'), where('teacherUid', '==', teacherUid))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, roomsPath);
  }

  for (const roomDoc of roomSnaps.docs) {
    const roomCode = roomDoc.id;
    const childRefs: ReturnType<typeof doc>[] = [];

    // 1. Delete pass hash & teacherSecret
    try {
      const secretSnap = await getDoc(doc(db, 'rooms', roomCode, 'teacherSecret', 'info'));
      if (secretSnap.exists()) {
        const pw = (secretSnap.data() as { joinPassword?: string }).joinPassword;
        if (pw) {
          const passHash = await hashRoomPassword(roomCode, pw);
          childRefs.push(doc(db, 'rooms', roomCode, 'passes', passHash));
        }
        childRefs.push(doc(db, 'rooms', roomCode, 'teacherSecret', 'info'));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `rooms/${roomCode}/teacherSecret/info`);
    }

    // 2. Delete 16 cards
    try {
      const cardSnaps = await getDocs(
        query(collection(db, 'rooms', roomCode, 'cards'), where('roomId', '==', roomCode))
      );
      cardSnaps.docs.forEach((d) => childRefs.push(d.ref));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `rooms/${roomCode}/cards`);
    }

    // 3. Delete all players, playerHands, and discardSlots in each group, then each group
    try {
      const groupSnaps = await getDocs(
        query(collection(db, 'rooms', roomCode, 'groups'), where('roomId', '==', roomCode))
      );
      for (const gDoc of groupSnaps.docs) {
        const [playerSnaps, handSnaps, discardSnaps] = await Promise.all([
          getDocs(
            query(
              collection(db, 'rooms', roomCode, 'groups', gDoc.id, 'players'),
              where('roomId', '==', roomCode)
            )
          ),
          getDocs(
            query(
              collection(db, 'rooms', roomCode, 'groups', gDoc.id, 'playerHands'),
              where('teacherUid', '==', teacherUid)
            )
          ),
          getDocs(
            query(
              collection(db, 'rooms', roomCode, 'groups', gDoc.id, 'discardSlots'),
              where('teacherUid', '==', teacherUid)
            )
          ),
        ]);
        playerSnaps.docs.forEach((p) => childRefs.push(p.ref));
        handSnaps.docs.forEach((h) => childRefs.push(h.ref));
        discardSnaps.docs.forEach((s) => childRefs.push(s.ref));
        childRefs.push(gDoc.ref);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `rooms/${roomCode}/groups`);
    }

    // Commit subcollection deletes BEFORE deleting parent room doc (required by isRoomTeacher rules)
    await commitDeleteRefs(childRefs, `rooms/${roomCode}/cleanup`);

    try {
      await deleteDoc(doc(db, 'rooms', roomCode));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `rooms/${roomCode}`);
    }
  }
}

