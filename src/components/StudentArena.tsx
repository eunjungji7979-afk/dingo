import { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX, ArrowLeft, Sparkles, Hand, Shuffle, Users } from 'lucide-react';
import {
  callDingo,
  claimCenterSlot,
  fetchPlayerHand,
  getRoom,
  joinGroup,
  startNextRoundForGroup,
  submitDiscardCard,
  subscribeGroupPlayers,
  subscribePlayerHand,
  subscribeRoom,
  subscribeRoomGroups,
  fetchRoomCards,
  triggerDiscardCommand,
  triggerPickCommand,
  verifyRoomPassword,
} from '../lib/dingoService';
import { soundEngine } from '../lib/sound';
import {
  MAX_NICKNAME_LEN,
  MAX_PASSWORD_LEN,
  type DingoCard,
  type DingoGroup,
  type GroupPlayer,
  type Room,
} from '../types/dingo';
import { CardBack } from './CardBack';
import { CardFace } from './CardFace';
import { FireworksCanvas } from './FireworksCanvas';

interface StudentArenaProps {
  uid: string;
  isTeacherUser?: boolean;
  initialRoomCode?: string;
  initialGroupNumber?: number;
  previewAsPlayerId?: string | null;
  onExitPreview?: () => void;
}

export function StudentArena({
  uid,
  isTeacherUser = false,
  initialRoomCode = '',
  initialGroupNumber,
  previewAsPlayerId = null,
  onExitPreview,
}: StudentArenaProps) {
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordVerified, setPasswordVerified] = useState(Boolean(previewAsPlayerId));
  const [activeRoomCode, setActiveRoomCode] = useState(
    previewAsPlayerId ? initialRoomCode : ''
  );
  const [room, setRoom] = useState<Room | null>(null);
  const [groups, setGroups] = useState<DingoGroup[]>([]);
  const [cards, setCards] = useState<DingoCard[]>([]);

  const [selectedGroupNum, setSelectedGroupNum] = useState<number>(initialGroupNumber ?? 1);
  const [nickname, setNickname] = useState('');
  const [joinedGroupNum, setJoinedGroupNum] = useState<number | null>(
    initialGroupNumber && previewAsPlayerId ? initialGroupNumber : null
  );
  const [players, setPlayers] = useState<GroupPlayer[]>([]);
  const [myHand, setMyHand] = useState<number[]>([]);

  const [selectedCardIdx, setSelectedCardIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [muted, setMuted] = useState(false);

  // For teacher practice-bot testing: allow switching active perspective among bots or self
  const [impersonateId, setImpersonateId] = useState<string | null>(previewAsPlayerId);

  const prevPhaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialRoomCode) {
      setRoomCodeInput(initialRoomCode);
      if (previewAsPlayerId) {
        setActiveRoomCode(initialRoomCode);
        setPasswordVerified(true);
      }
    }
  }, [initialRoomCode, previewAsPlayerId]);

  useEffect(() => {
    if (previewAsPlayerId) {
      setImpersonateId(previewAsPlayerId);
    }
  }, [previewAsPlayerId]);

  // Subscribe to Room, Groups, and Cards once activeRoomCode & passwordVerified are set
  useEffect(() => {
    if (!activeRoomCode || !passwordVerified) return;

    let cancelled = false;
    const unsubRoom = subscribeRoom(activeRoomCode, (r) => {
      if (cancelled) return;
      if (!r) {
        setRoom(null);
        setGroups([]);
        setCards([]);
        setJoinedGroupNum(null);
        setPlayers([]);
        setActiveRoomCode('');
        setPasswordVerified(false);
        setSelectedCardIdx(null);
        setErrorMsg('선생님이 수업 방을 초기화했습니다. 새 방 코드와 비밀번호로 입장해 주세요.');
        return;
      }
      setRoom(r);
    });
    const unsubGroups = subscribeRoomGroups(activeRoomCode, (gs) => {
      if (!cancelled) setGroups(gs);
    });

    void fetchRoomCards(activeRoomCode).then((loadedCards) => {
      if (!cancelled) setCards(loadedCards);
    });

    return () => {
      cancelled = true;
      unsubRoom();
      unsubGroups();
    };
  }, [activeRoomCode, passwordVerified]);

  // Subscribe to Group Players once joined (public metadata only, zero card indices)
  useEffect(() => {
    if (!activeRoomCode || joinedGroupNum === null) return;
    const unsub = subscribeGroupPlayers(activeRoomCode, joinedGroupNum, (list) => {
      setPlayers(list);
    });
    return () => unsub();
  }, [activeRoomCode, joinedGroupNum]);

  const activePlayerId = impersonateId || uid;

  // Subscribe ONLY to my own private hand document
  useEffect(() => {
    if (!activeRoomCode || joinedGroupNum === null || !activePlayerId) {
      setMyHand([]);
      return;
    }
    const unsub = subscribePlayerHand(
      activeRoomCode,
      joinedGroupNum,
      activePlayerId,
      (hand) => {
        setMyHand(hand);
      }
    );
    return () => unsub();
  }, [activeRoomCode, joinedGroupNum, activePlayerId]);

  const currentGroup = useMemo(
    () => groups.find((g) => g.groupNumber === joinedGroupNum) ?? null,
    [groups, joinedGroupNum]
  );

  // Detect phase transitions for sound cues
  useEffect(() => {
    if (!currentGroup) return;
    const prev = prevPhaseRef.current;
    if (prev && prev !== currentGroup.phase) {
      if (currentGroup.phase === 'DISCARDING') {
        soundEngine.playDiscardCue();
        setSelectedCardIdx(null);
      } else if (currentGroup.phase === 'PICKING') {
        soundEngine.playPickCue();
      } else if (currentGroup.phase === 'DINGO_WON') {
        soundEngine.playDingoFanfare();
      }
    }
    prevPhaseRef.current = currentGroup.phase;
  }, [currentGroup]);

  const cardMap = useMemo(() => {
    const map = new Map<number, DingoCard>();
    cards.forEach((c) => map.set(c.index, c));
    return map;
  }, [cards]);

  const myPlayer = useMemo(
    () => players.find((p) => p.id === activePlayerId) ?? null,
    [players, activePlayerId]
  );

  const isTeacher = isTeacherUser && Boolean(previewAsPlayerId);
  const isHost = currentGroup ? currentGroup.hostPlayerId === activePlayerId : false;
  const isActiveCardPlayer = currentGroup
    ? currentGroup.activePlayerIds.includes(activePlayerId)
    : false;

  const hasBots = useMemo(() => players.some((p) => p.isBot), [players]);

  const discardedCount = useMemo(() => {
    if (!currentGroup) return 0;
    const activeSet = new Set(currentGroup.activePlayerIds);
    return players.filter((p) => activeSet.has(p.id) && p.hasDiscarded).length;
  }, [players, currentGroup]);

  const activeTotal = currentGroup?.activePlayerIds.length ?? 0;
  const allDiscarded = activeTotal > 0 && discardedCount === activeTotal;

  const hostPlayer = useMemo(
    () => players.find((p) => p.id === currentGroup?.hostPlayerId) ?? null,
    [players, currentGroup]
  );

  const nextHostPlayer = useMemo(() => {
    if (!currentGroup || players.length === 0) return null;
    const nextIdx = (currentGroup.hostIndex + 1) % players.length;
    return players[nextIdx] ?? null;
  }, [players, currentGroup]);

  const handleFindRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const code = roomCodeInput.trim().toUpperCase();
    const pw = passwordInput.trim();
    if (!/^[A-Z0-9]{4,10}$/.test(code)) {
      setErrorMsg('올바른 방 코드(영문/숫자 4~10자리)를 입력해 주세요.');
      return;
    }
    if (!pw) {
      setErrorMsg('선생님이 안내한 입장 비밀번호를 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const found = await getRoom(code);
      if (!found) {
        setErrorMsg('해당 방 코드를 찾을 수 없습니다. 링크 또는 방 코드를 확인해 주세요.');
      } else if (found.status === 'ENDED') {
        setErrorMsg('이미 종료된 게임 방입니다.');
      } else {
        const ok = await verifyRoomPassword(code, pw);
        if (!ok) {
          setErrorMsg('입장 비밀번호가 일치하지 않습니다. 다시 확인해 주세요.');
          return;
        }
        setActiveRoomCode(code);
        setRoom(found);
        setPasswordVerified(true);
        setSelectedGroupNum(1);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '방 입장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoomCode) return;
    setErrorMsg('');
    const cleanName = nickname.trim().slice(0, MAX_NICKNAME_LEN);
    if (!cleanName) {
      setErrorMsg('닉네임을 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      await joinGroup(activeRoomCode, selectedGroupNum, uid, cleanName);
      setJoinedGroupNum(selectedGroupNum);
      setImpersonateId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '모둠 입장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDiscardTrigger = async () => {
    if (!currentGroup) return;
    setErrorMsg('');
    setBusy(true);
    try {
      await triggerDiscardCommand(currentGroup.roomId, currentGroup.groupNumber);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '버려 명령 실행에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitDiscard = async () => {
    if (!currentGroup || !myPlayer || selectedCardIdx === null) return;
    setErrorMsg('');
    setBusy(true);
    try {
      await submitDiscardCard(
        currentGroup.roomId,
        currentGroup.groupNumber,
        myPlayer.id,
        selectedCardIdx
      );
      soundEngine.playCardSubmit();
      setSelectedCardIdx(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '카드 버리기에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handlePickTrigger = async () => {
    if (!currentGroup) return;
    setErrorMsg('');
    setBusy(true);
    try {
      await triggerPickCommand(
        currentGroup.roomId,
        currentGroup.groupNumber,
        currentGroup.activePlayerIds
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '집어 명령 실행에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleClaimSlot = async (slotIdx: number) => {
    if (!currentGroup || !myPlayer) return;
    setErrorMsg('');
    setInfoMsg('');
    setBusy(true);
    try {
      const res = await claimCenterSlot(
        currentGroup.roomId,
        currentGroup.groupNumber,
        myPlayer.id,
        slotIdx
      );
      if (res.alreadyClaimed) {
        setInfoMsg('이미 다른 친구가 가져간 카드입니다. 남은 카드를 눌러주세요!');
      } else {
        soundEngine.playCardPick();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '카드 집기에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleCallDingo = async () => {
    if (!currentGroup || !myPlayer) return;
    setErrorMsg('');
    setBusy(true);
    try {
      await callDingo(
        currentGroup.roomId,
        currentGroup.groupNumber,
        myPlayer.id,
        myPlayer.nickname,
        myHand
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '딩고 선언에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleNextRound = async () => {
    if (!currentGroup) return;
    setErrorMsg('');
    setBusy(true);
    try {
      await startNextRoundForGroup(
        currentGroup.roomId,
        currentGroup.groupNumber,
        currentGroup,
        players
      );
      setSelectedCardIdx(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '다음 라운드 시작에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  // Helper for teacher testing with bots: bots auto-discard or auto-pick
  const handleBotsAutoDiscard = async () => {
    if (!currentGroup || !isTeacher) return;
    setBusy(true);
    try {
      const activeSet = new Set(currentGroup.activePlayerIds);
      const pendingBots = players.filter(
        (p) => p.isBot && activeSet.has(p.id) && !p.hasDiscarded && p.handCount > 0
      );
      for (const bot of pendingBots) {
        const botHand = await fetchPlayerHand(
          currentGroup.roomId,
          currentGroup.groupNumber,
          bot.id
        );
        if (botHand.length > 0) {
          const randCard = botHand[Math.floor(Math.random() * botHand.length)];
          await submitDiscardCard(currentGroup.roomId, currentGroup.groupNumber, bot.id, randCard);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBotsAutoPick = async () => {
    if (!currentGroup || !isTeacher) return;
    setBusy(true);
    try {
      const activeSet = new Set(currentGroup.activePlayerIds);
      const pendingBots = players.filter(
        (p) => p.isBot && activeSet.has(p.id) && p.hasDiscarded && p.handCount < 4
      );
      for (const bot of pendingBots) {
        const unclaimedIndices = currentGroup.centerClaimedBy
          .map((claimedBy, idx) => (claimedBy === '' ? idx : -1))
          .filter((idx) => idx !== -1);
        for (const idx of unclaimedIndices) {
          const res = await claimCenterSlot(
            currentGroup.roomId,
            currentGroup.groupNumber,
            bot.id,
            idx
          );
          if (!res.alreadyClaimed) {
            currentGroup.centerClaimedBy[idx] = bot.id;
            break;
          }
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundEngine.setMuted(next);
  };

  // --- STEP 1: Enter Room Code & Password ---
  if (!activeRoomCode || !room || !passwordVerified) {
    return (
      <div className="max-w-lg mx-auto py-12 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">학생 모둠 입장</h1>
          <p className="text-sm text-slate-600 mb-6">
            별도 로그인 없이 선생님이 알려준 방 코드와 입장 비밀번호로 바로 들어올 수 있습니다.
          </p>

          <form onSubmit={handleFindRoom} className="space-y-4">
            <div>
              <label htmlFor="roomCode" className="block text-sm font-semibold text-slate-800 mb-1.5">
                방 코드
              </label>
              <input
                id="roomCode"
                type="text"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                placeholder="예: DINGO7"
                maxLength={10}
                className="w-full px-4 py-3 text-lg font-mono-num tracking-widest uppercase border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div>
              <label htmlFor="roomPassword" className="block text-sm font-semibold text-slate-800 mb-1.5">
                입장 비밀번호
              </label>
              <input
                id="roomPassword"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="선생님이 안내한 비밀번호 입력"
                maxLength={MAX_PASSWORD_LEN}
                className="w-full px-4 py-3 text-base border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            {errorMsg && (
              <p className="text-sm font-medium text-rose-600" role="alert">
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl transition-colors"
            >
              {busy ? '비밀번호 확인 중...' : '방 들어가기'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- STEP 2: Select Group Number & Enter Nickname ---
  if (joinedGroupNum === null) {
    return (
      <div className="max-w-xl mx-auto py-10 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-xs font-semibold text-emerald-700 mb-1">
                방 코드 {room.roomCode}
              </p>
              <h1 className="text-2xl font-bold text-slate-900">{room.title}</h1>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveRoomCode('');
                setRoom(null);
                setPasswordVerified(false);
                setPasswordInput('');
              }}
              className="text-sm font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap shrink-0"
            >
              다른 방 찾기
            </button>
          </div>

          <form onSubmit={handleJoinGroup} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">
                몇 모둠인가요?
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {Array.from({ length: room.totalGroups }, (_, idx) => idx + 1).map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setSelectedGroupNum(num)}
                    className={`py-3 px-3 rounded-xl font-semibold text-sm border transition-colors whitespace-nowrap ${
                      selectedGroupNum === num
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {num}모둠
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="nickname" className="block text-sm font-semibold text-slate-800 mb-1.5">
                내 닉네임
              </label>
              <input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="예: 김민수"
                maxLength={MAX_NICKNAME_LEN}
                className="w-full px-4 py-3 text-base border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            {errorMsg && (
              <p className="text-sm font-medium text-rose-600" role="alert">
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl transition-colors"
            >
              {busy ? '입장 중...' : `${selectedGroupNum}모둠으로 입장하기`}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- STEP 3: Group Lobby (Waiting for Teacher to Click Start) ---
  if (!currentGroup || currentGroup.phase === 'LOBBY') {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-1">
                <span>{room.title}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num">{room.roomCode}</span>
                <span aria-hidden="true">·</span>
                <span>{joinedGroupNum}모둠</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">모둠 대기실</h1>
            </div>

            <button
              type="button"
              onClick={() => {
                if (onExitPreview) {
                  onExitPreview();
                } else {
                  setJoinedGroupNum(null);
                }
              }}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              나가기
            </button>
          </div>

          <div className="py-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-800">
                현재 들어온 친구 ({players.length}/5명)
              </h2>
              <span className="text-xs text-slate-500">
                {players.length === 5
                  ? '5명 모둠: 진행자 1명 + 게임 4명'
                  : '4명 기준: 4명 모두 게임 참여'}
              </span>
            </div>

            {players.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center bg-slate-50 rounded-xl">
                참여 정보를 불러오는 중입니다...
              </p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {players.map((p, idx) => (
                  <li
                    key={p.id}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                      p.id === activePlayerId
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                        : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  >
                    <span className="font-semibold text-sm truncate">
                      {idx + 1}. {p.nickname}
                    </span>
                    <span className="text-xs text-slate-500 shrink-0">
                      {p.id === activePlayerId ? '나' : p.isBot ? '연습생' : '참여'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-700">
            선생님이 들어온 학생을 확인하고 <strong>게임 시작</strong> 버튼을 누르면
            자동으로 4장씩 카드가 배부됩니다.
          </div>
        </div>
      </div>
    );
  }

  // --- STEP 4: Active Felt Card Table ---
  const phaseLabelMap: Record<DingoGroup['phase'], string> = {
    LOBBY: '대기 중',
    VIEWING: '카드 확인 중',
    DISCARDING: '카드 버리는 중',
    PICKING: '카드 집는 중',
    DINGO_WON: '딩고 달성!',
  };

  const canCallDingo =
    isActiveCardPlayer &&
    myPlayer &&
    myHand.length === 4 &&
    (currentGroup.phase === 'VIEWING' || currentGroup.phase === 'PICKING');

  const isDedicatedHost = players.length === 5 && isHost && myHand.length === 0 && !isActiveCardPlayer;
  const needsToDiscard =
    currentGroup.phase === 'DISCARDING' &&
    isActiveCardPlayer &&
    myPlayer &&
    !myPlayer.hasDiscarded;

  const needsToPick =
    currentGroup.phase === 'PICKING' &&
    isActiveCardPlayer &&
    myPlayer &&
    myPlayer.hasDiscarded &&
    myHand.length < 4;

  return (
    <div className="min-h-[calc(100vh-65px)] felt-surface text-white px-4 py-5 flex flex-col">
      <FireworksCanvas active={currentGroup.phase === 'DINGO_WON'} />

      <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col gap-5">
        {/* Top Table HUD */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-black/25 border border-white/10 rounded-xl px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold text-white">{joinedGroupNum}모둠</span>
            <span className="text-white/40" aria-hidden="true">·</span>
            <span className="font-mono-num text-emerald-200">라운드 {currentGroup.roundNumber}</span>
            <span className="text-white/40" aria-hidden="true">·</span>
            <span className="text-amber-300 font-semibold">
              진행자: {hostPlayer?.nickname ?? '-'}
            </span>
            <span className="text-white/40" aria-hidden="true">·</span>
            <span className="text-white/80">{phaseLabelMap[currentGroup.phase]}</span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? '효과음 켜기' : '효과음 끄기'}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                if (onExitPreview) {
                  onExitPreview();
                } else {
                  setJoinedGroupNum(null);
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold whitespace-nowrap"
            >
              {onExitPreview ? '교사 화면으로' : '나가기'}
            </button>
          </div>
        </div>

        {/* Group Seats Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {players.map((p) => {
            const pIsHost = p.id === currentGroup.hostPlayerId;
            const pIsMe = p.id === activePlayerId;
            const pIsActive = currentGroup.activePlayerIds.includes(p.id);

            return (
              <div
                key={p.id}
                className={`px-3 py-2.5 rounded-xl border transition-colors ${
                  pIsMe
                    ? 'bg-emerald-900/80 border-amber-300/70'
                    : 'bg-black/20 border-white/10'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-sm font-bold truncate">
                    {p.nickname}
                    {pIsMe ? ' (나)' : ''}
                  </span>
                </div>
                <div className="text-xs text-white/75 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span>{pIsHost ? '진행자' : '플레이어'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num truncate">
                      {!pIsActive
                        ? '전담 진행'
                        : currentGroup.phase === 'DISCARDING'
                        ? p.hasDiscarded
                          ? '버림 완료'
                          : '선택 중'
                        : `${p.handCount}장`}
                    </span>
                  </div>
                  {!pIsMe && pIsActive && p.handCount > 0 && (
                    <div
                      className="flex items-center gap-0.5 shrink-0"
                      aria-label={`${p.nickname}의 비공개 카드 ${p.handCount}장`}
                    >
                      {Array.from({ length: p.handCount }).map((_, idx) => (
                        <span
                          key={idx}
                          className="w-2.5 h-3.5 rounded-[2px] bg-[#14533C] border border-amber-300/50 inline-block"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Center Table Zone */}
        <div className="flex-1 bg-black/20 border border-white/15 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[270px] relative">
          {errorMsg && (
            <div className="mb-4 px-4 py-2 bg-rose-600/90 text-white text-sm font-semibold rounded-lg">
              {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div className="mb-4 px-4 py-2 bg-amber-500 text-slate-950 text-sm font-semibold rounded-lg">
              {infoMsg}
            </div>
          )}

          {/* VIEWING PHASE */}
          {currentGroup.phase === 'VIEWING' && (
            <div className="text-center max-w-lg space-y-5 animate-dingo-pop">
              <div className="space-y-2">
                <h2 className="text-2xl font-extrabold text-white">
                  내 카드 4장을 확인하세요
                </h2>
                <p className="text-sm text-emerald-100/90">
                  {isHost
                    ? '모든 친구가 카드를 확인했으면 아래 [버려!] 버튼을 눌러주세요.'
                    : `진행자(${hostPlayer?.nickname ?? ''})가 '버려!' 버튼을 누르면 1장을 버립니다.`}
                </p>
              </div>

              {isHost && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDiscardTrigger}
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-lg font-extrabold rounded-xl shadow-lg transition-transform active:scale-95"
                >
                  <Hand className="w-5 h-5" />
                  버려!
                </button>
              )}
            </div>
          )}

          {/* DISCARDING PHASE */}
          {currentGroup.phase === 'DISCARDING' && (
            <div className="w-full max-w-2xl flex flex-col items-center gap-5 animate-dingo-pop">
              <div className="text-center space-y-1">
                <h2 className="text-xl font-extrabold text-white">
                  {allDiscarded
                    ? `${activeTotal}장의 카드가 뒤집힌 채로 가운데 모였습니다!`
                    : `뒤집힌 카드 모음 · ${discardedCount} / ${activeTotal}장`}
                </h2>
                <p className="text-sm text-emerald-100/90">
                  {allDiscarded
                    ? isHost
                      ? '모두 카드를 냈습니다. [집어!] 버튼을 눌러주세요!'
                      : `진행자(${hostPlayer?.nickname ?? ''})가 '집어!' 버튼을 누를 때까지 기다리세요.`
                    : needsToDiscard
                    ? '아래 내 손패에서 버릴 카드 1장을 선택한 뒤 [선택한 카드 버리기]를 누르세요.'
                    : '다른 친구들이 카드를 1장씩 버리기를 기다리고 있습니다.'}
                </p>
              </div>

              {/* Face-down cards gathered in center */}
              <div className="grid grid-cols-4 gap-3 sm:gap-4 w-full max-w-md">
                {Array.from({ length: activeTotal }).map((_, idx) => (
                  <div key={idx} className="w-full">
                    {idx < discardedCount ? (
                      <CardBack label="비공개" />
                    ) : (
                      <div className="aspect-[3/4] w-full rounded-xl border-2 border-dashed border-white/25 bg-white/5 flex items-center justify-center text-xs text-white/50">
                        대기 중
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {allDiscarded && isHost && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handlePickTrigger}
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-lg font-extrabold rounded-xl shadow-lg transition-transform active:scale-95"
                >
                  <Sparkles className="w-5 h-5" />
                  집어!
                </button>
              )}
            </div>
          )}

          {/* PICKING PHASE */}
          {currentGroup.phase === 'PICKING' && (
            <div className="w-full max-w-2xl flex flex-col items-center gap-5 animate-dingo-pop">
              <div className="text-center space-y-1">
                <h2 className="text-xl font-extrabold text-amber-300">
                  집어! 뒤집힌 카드 1장을 가져가세요
                </h2>
                <p className="text-sm text-emerald-100/90">
                  {needsToPick
                    ? '원하는 뒤집힌 카드를 터치하면 내 손으로 1장 들어옵니다.'
                    : '이번 차례의 카드를 모두 가져갈 때까지 기다리세요.'}
                </p>
              </div>

              <div className="grid grid-cols-4 gap-3 sm:gap-4 w-full max-w-md">
                {currentGroup.centerCardIds.map((_, slotIdx) => {
                  const claimedBy = currentGroup.centerClaimedBy[slotIdx];
                  const claimer = players.find((p) => p.id === claimedBy);
                  const isClaimed = claimedBy !== '';

                  if (isClaimed) {
                    return (
                      <div
                        key={slotIdx}
                        className="aspect-[3/4] w-full rounded-xl border border-white/15 bg-black/25 flex flex-col items-center justify-center p-2 text-center"
                      >
                        <span className="text-xs font-semibold text-white/70 truncate w-full">
                          {claimer?.nickname ?? '가져감'}
                        </span>
                        <span className="text-[11px] text-white/45 mt-1">가져감</span>
                      </div>
                    );
                  }

                  return (
                    <CardBack
                      key={slotIdx}
                      label={needsToPick ? '집기' : '대기'}
                      interactive={Boolean(needsToPick)}
                      disabled={!needsToPick || busy}
                      onClick={() => void handleClaimSlot(slotIdx)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* DINGO WON PHASE */}
          {currentGroup.phase === 'DINGO_WON' && (
            <div className="w-full max-w-2xl flex flex-col items-center gap-5 text-center animate-dingo-pop relative z-10">
              <div>
                <p className="text-sm font-bold text-amber-300 tracking-wide mb-1">
                  축하합니다!
                </p>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
                  {currentGroup.winnerNickname}님 딩고!
                </h2>
              </div>

              <div className="grid grid-cols-4 gap-3 w-full max-w-md">
                {currentGroup.winningHand.map((cardIdx, idx) => (
                  <CardFace key={`${cardIdx}-${idx}`} card={cardMap.get(cardIdx)} />
                ))}
              </div>

              {(isHost || currentGroup.winnerId === activePlayerId || isTeacher) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleNextRound}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-extrabold rounded-xl shadow-lg transition-transform active:scale-95"
                >
                  <Shuffle className="w-5 h-5" />
                  카드 섞고 다음 라운드 시작 (새 진행자: {nextHostPlayer?.nickname ?? '다음 친구'})
                </button>
              )}
            </div>
          )}
        </div>

        {/* Bottom Player Hand / Dedicated Host Desk */}
        <div className="bg-black/30 border border-white/15 rounded-2xl p-5">
          {isDedicatedHost ? (
            <div className="text-center py-4 space-y-2">
              <div className="inline-flex items-center gap-2 text-amber-300 font-bold text-base">
                <Users className="w-5 h-5" />
                이번 라운드는 전담 진행자입니다 (5명 모둠 규칙)
              </div>
              <p className="text-sm text-white/75 max-w-xl mx-auto">
                모둠에 5명이 참여하여 1명이 진행하고 4명이 카드로 게임합니다.
                딩고가 나온 뒤 다음 라운드에서는 자동으로 교대되어 카드를 받습니다.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-bold text-white">
                    내 카드 ({myHand.length}장 · 나만 볼 수 있음)
                  </h3>
                  {needsToDiscard && (
                    <span className="text-xs font-semibold text-rose-300">
                      버릴 카드 1장을 눌러 선택하세요
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {needsToDiscard && selectedCardIdx !== null && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSubmitDiscard}
                      className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow transition-colors whitespace-nowrap"
                    >
                      선택한 카드 버리기
                    </button>
                  )}

                  {canCallDingo && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleCallDingo}
                      className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-extrabold text-base rounded-xl shadow-lg transition-transform active:scale-95 whitespace-nowrap"
                    >
                      딩고!
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 sm:gap-5 max-w-2xl mx-auto">
                {myHand.map((cardIdx, slotPos) => (
                  <CardFace
                    key={`${cardIdx}-${slotPos}`}
                    card={cardMap.get(cardIdx)}
                    selectable={Boolean(needsToDiscard)}
                    selected={Boolean(needsToDiscard && selectedCardIdx === cardIdx)}
                    badgeText={
                      needsToDiscard && selectedCardIdx === cardIdx ? '버릴 카드' : undefined
                    }
                    onClick={
                      needsToDiscard
                        ? () =>
                            setSelectedCardIdx((prev) =>
                              prev === cardIdx ? null : cardIdx
                            )
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Teacher / Practice Bot Simulation Controls (visible only when group has bots & user is room teacher) */}
        {isTeacher && hasBots && (
          <div className="bg-slate-900/90 border border-amber-400/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-amber-300">연습 모드 시점 전환:</span>
              {players.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setImpersonateId(p.id);
                    setSelectedCardIdx(null);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors ${
                    activePlayerId === p.id
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {p.nickname}
                  {p.id === currentGroup.hostPlayerId ? ' (진행)' : ''}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {currentGroup.phase === 'DISCARDING' && !allDiscarded && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleBotsAutoDiscard}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-lg"
                >
                  연습생 자동 버리기
                </button>
              )}
              {currentGroup.phase === 'PICKING' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleBotsAutoPick}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg"
                >
                  연습생 자동 집기
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
