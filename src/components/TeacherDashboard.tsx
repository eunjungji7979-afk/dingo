import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Copy,
  Check,
  Play,
  Users,
  Plus,
  Trash2,
  Eye,
  Sparkles,
  FileImage,
  Square,
} from 'lucide-react';
import {
  addPracticeBots,
  createRoom,
  deleteAllTeacherRooms,
  endRoom,
  fetchRoomCards,
  fetchTeacherRoomPassword,
  removePlayer,
  startGame,
  startNextRoundForGroup,
  subscribeGroupPlayers,
  subscribeRoomGroups,
  subscribeTeacherRooms,
} from '../lib/dingoService';
import {
  DEFAULT_SLICE_MARGINS,
  generateSampleDeck,
  renderFileToSourceCanvas,
  sliceCanvasInto16Cards,
  type SliceMargins,
} from '../lib/cardSlicer';
import {
  MAX_GROUPS,
  MAX_PASSWORD_LEN,
  MAX_ROOM_TITLE_LEN,
  MIN_GROUPS,
  type DingoCard,
  type DingoGroup,
  type GroupPlayer,
  type Room,
  type SlicedCardDraft,
} from '../types/dingo';
import { StudentArena } from './StudentArena';

export function TeacherDashboard({ teacherUid }: { teacherUid: string }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomCode, setSelectedRoomCode] = useState<string>('');
  const [creatingNew, setCreatingNew] = useState<boolean>(false);

  // Room creation state
  const [title, setTitle] = useState('우리 반 딩고 게임');
  const [totalGroups, setTotalGroups] = useState(4);
  const [joinPassword, setJoinPassword] = useState('1234');
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string>('');
  const [margins, setMargins] = useState<SliceMargins>(DEFAULT_SLICE_MARGINS);
  const [draftCards, setDraftCards] = useState<SlicedCardDraft[]>([]);
  const [fileName, setFileName] = useState('');
  const [slicingBusy, setSlicingBusy] = useState(false);

  // Active room live state
  const [groups, setGroups] = useState<DingoGroup[]>([]);
  const [roomCards, setRoomCards] = useState<DingoCard[]>([]);
  const [roomPassword, setRoomPassword] = useState<string>('');
  const [playersByGroup, setPlayersByGroup] = useState<Record<number, GroupPlayer[]>>({});
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resettingBusy, setResettingBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Teacher previewing a specific group table (e.g. with practice bots)
  const [previewGroupNum, setPreviewGroupNum] = useState<number | null>(null);
  const [showDeckModal, setShowDeckModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Subscribe to teacher's created rooms
  useEffect(() => {
    const unsub = subscribeTeacherRooms(teacherUid, (list) => {
      setRooms(list);
      if (!selectedRoomCode && !creatingNew && !resettingBusy && list.length > 0) {
        const active = list.find((r) => r.status !== 'ENDED') ?? list[0];
        setSelectedRoomCode(active.roomCode);
      }
    });
    return () => unsub();
  }, [teacherUid, selectedRoomCode, creatingNew, resettingBusy]);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.roomCode === selectedRoomCode) ?? null,
    [rooms, selectedRoomCode]
  );

  // Subscribe to groups, cards, and password of activeRoom
  useEffect(() => {
    if (!activeRoom) {
      setGroups([]);
      setRoomCards([]);
      setRoomPassword('');
      setPlayersByGroup({});
      return;
    }

    const unsubGroups = subscribeRoomGroups(activeRoom.roomCode, (gs) => {
      setGroups(gs);
    });

    void fetchRoomCards(activeRoom.roomCode).then((cs) => setRoomCards(cs));
    void fetchTeacherRoomPassword(activeRoom.roomCode).then((pw) =>
      setRoomPassword(pw ?? '')
    );

    return () => unsubGroups();
  }, [activeRoom?.roomCode]);

  // Subscribe to players in each group
  useEffect(() => {
    if (!activeRoom) return;
    const unsubs: (() => void)[] = [];
    for (let g = 1; g <= activeRoom.totalGroups; g++) {
      const unsub = subscribeGroupPlayers(activeRoom.roomCode, g, (list) => {
        setPlayersByGroup((prev) => ({ ...prev, [g]: list }));
      });
      unsubs.push(unsub);
    }
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [activeRoom?.roomCode, activeRoom?.totalGroups]);

  // Re-slice whenever sourceCanvas or margins change
  useEffect(() => {
    if (!sourceCanvas) return;
    const sliced = sliceCanvasInto16Cards(sourceCanvas, margins);
    setDraftCards(sliced);
  }, [sourceCanvas, margins]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    setSlicingBusy(true);
    setFileName(file.name);
    try {
      const canvas = await renderFileToSourceCanvas(file);
      setSourceCanvas(canvas);
      setSourcePreviewUrl(canvas.toDataURL('image/jpeg', 0.8));
      setMargins(DEFAULT_SLICE_MARGINS);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '파일을 처리할 수 없습니다.');
    } finally {
      setSlicingBusy(false);
    }
  };

  const handleLoadSampleDeck = () => {
    setErrorMsg('');
    setSourceCanvas(null);
    setSourcePreviewUrl('');
    setFileName('기본 샘플 딩고 카드 (16장)');
    setDraftCards(generateSampleDeck());
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!joinPassword.trim()) {
      setErrorMsg('학생들이 입력할 입장 비밀번호를 정해주세요.');
      return;
    }
    if (draftCards.length !== 16) {
      setErrorMsg('먼저 1장의 PDF/JPG 파일을 올려 16장의 카드를 준비해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const code = await createRoom(teacherUid, title, totalGroups, joinPassword, draftCards);
      setCreatingNew(false);
      setSelectedRoomCode(code);
      setDraftCards([]);
      setSourceCanvas(null);
      setSourcePreviewUrl('');
      setFileName('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '게임 방 생성에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const totalJoinedStudents = useMemo(
    () =>
      Object.values(playersByGroup).reduce((sum, list) => sum + list.length, 0),
    [playersByGroup]
  );

  const handleCopyInviteLink = async () => {
    if (!activeRoom) return;
    const url = `${window.location.origin}/?room=${activeRoom.roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleStartGame = async () => {
    if (!activeRoom) return;
    if (totalJoinedStudents === 0) {
      setErrorMsg('최소 1개 모둠에 학생이 들어와야 시작할 수 있습니다.');
      return;
    }
    setErrorMsg('');
    setBusy(true);
    try {
      await startGame(activeRoom.roomCode, groups, playersByGroup);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '게임 시작에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleEndRoom = async () => {
    if (!activeRoom) return;
    setBusy(true);
    try {
      await endRoom(activeRoom.roomCode);
    } finally {
      setBusy(false);
    }
  };

  const handleResetAndCreateNew = async () => {
    const prevRoomCode = selectedRoomCode;
    setErrorMsg('');
    setResettingBusy(true);
    // Clear active room selection immediately so group/player snapshot listeners detach before deletion
    setSelectedRoomCode('');
    setGroups([]);
    setRoomCards([]);
    setRoomPassword('');
    setPlayersByGroup({});
    setPreviewGroupNum(null);
    setShowDeckModal(false);

    try {
      await deleteAllTeacherRooms(teacherUid);
      setRooms([]);
      setTitle('우리 반 딩고 게임');
      setTotalGroups(4);
      setJoinPassword('1234');
      setSourceCanvas(null);
      setSourcePreviewUrl('');
      setMargins(DEFAULT_SLICE_MARGINS);
      setDraftCards([]);
      setFileName('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setCreatingNew(true);
    } catch (err) {
      if (prevRoomCode) {
        setSelectedRoomCode(prevRoomCode);
      }
      setErrorMsg(
        err instanceof Error ? err.message : '기존 데이터를 삭제하는 중 오류가 발생했습니다.'
      );
    } finally {
      setResettingBusy(false);
    }
  };

  // If teacher opened a group preview/test table
  if (activeRoom && previewGroupNum !== null) {
    const groupPlayers = playersByGroup[previewGroupNum] ?? [];
    const firstPlayerId = groupPlayers[0]?.id ?? teacherUid;
    return (
      <StudentArena
        uid={teacherUid}
        isTeacherUser={true}
        initialRoomCode={activeRoom.roomCode}
        initialGroupNumber={previewGroupNum}
        previewAsPlayerId={firstPlayerId}
        onExitPreview={() => setPreviewGroupNum(null)}
      />
    );
  }

  // Show Room Creation Form when requested or no rooms exist yet
  const showCreator = creatingNew || (!activeRoom && rooms.length === 0);

  if (showCreator) {
    return (
      <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">새 딩고 수업 만들기</h1>
            <p className="text-sm text-slate-600 mt-1">
              모둠 수를 정하고 16장의 딩고 카드가 담긴 PDF 또는 JPG 파일 1장을 올려주세요.
            </p>
          </div>
          {rooms.length > 0 && (
            <button
              type="button"
              onClick={() => setCreatingNew(false)}
              className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              내 방 목록으로
            </button>
          )}
        </div>

        <form onSubmit={handleCreateRoom} className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label htmlFor="lessonTitle" className="block text-sm font-semibold text-slate-800 mb-1.5">
                  수업 / 게임 이름
                </label>
                <input
                  id="lessonTitle"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={MAX_ROOM_TITLE_LEN}
                  placeholder="예: 4학년 2반 단어 딩고"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label htmlFor="joinPassword" className="block text-sm font-semibold text-slate-800 mb-1.5">
                  학생 입장 비밀번호
                </label>
                <input
                  id="joinPassword"
                  type="text"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  maxLength={MAX_PASSWORD_LEN}
                  placeholder="예: 1234 또는 사과"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  모둠 수 (2~7모둠 · 현재 {totalGroups}모둠)
                </label>
                <div className="grid grid-cols-6 gap-1.5">
                  {[2, 3, 4, 5, 6, 7].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setTotalGroups(n)}
                      className={`py-2.5 text-xs font-bold rounded-xl border transition-colors whitespace-nowrap ${
                        totalGroups === n
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={MIN_GROUPS}
                  max={MAX_GROUPS}
                  value={totalGroups}
                  onChange={(e) => setTotalGroups(Number(e.target.value))}
                  aria-label="모둠 수 슬라이더"
                  className="w-full mt-2 accent-emerald-700"
                />
              </div>
            </div>

            {/* File Upload Area */}
            <div className="pt-4 border-t border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">
                    16장 딩고 카드 파일 업로드 (PDF 또는 JPG/PNG 1장)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    4×4로 배열된 1장의 PDF/JPG 파일을 자동으로 16장 카드로 분할합니다.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleLoadSampleDeck}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  기본 샘플 카드 16장 불러오기
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                onChange={handleFileUpload}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-300 hover:border-emerald-600 rounded-2xl p-6 text-center bg-slate-50/70 hover:bg-emerald-50/30 transition-colors"
              >
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-7 h-7 text-emerald-700" />
                  <p className="text-sm font-semibold text-slate-800">
                    {slicingBusy
                      ? '파일을 16장으로 분할하는 중...'
                      : fileName
                      ? `선택된 파일: ${fileName} (클릭하여 변경)`
                      : 'PDF 또는 JPG/PNG 파일 1장을 선택해 올려주세요'}
                  </p>
                  <p className="text-xs text-slate-500">
                    권장: 4행 × 4열 (총 16칸)으로 구성된 1페이지 학습지
                  </p>
                </div>
              </button>
            </div>

            {/* Interactive Cut-Line Alignment Controls when PDF/JPG uploaded */}
            {sourcePreviewUrl && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4 border-t border-slate-200">
                <div className="lg:col-span-5 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-800">
                    원본 분할선 미리보기
                  </h3>
                  <div className="relative border border-slate-300 rounded-xl overflow-hidden bg-white">
                    <img
                      src={sourcePreviewUrl}
                      alt="업로드된 16장 딩고 카드 시트"
                      className="w-full h-auto block"
                    />
                    {/* Overlay grid crop guides */}
                    <div
                      aria-hidden="true"
                      className="absolute border-2 border-rose-500 pointer-events-none grid grid-cols-4 grid-rows-4"
                      style={{
                        top: `${margins.topPct}%`,
                        bottom: `${margins.bottomPct}%`,
                        left: `${margins.leftPct}%`,
                        right: `${margins.rightPct}%`,
                        gap: `${margins.gapYPct}% ${margins.gapXPct}%`,
                      }}
                    >
                      {Array.from({ length: 16 }).map((_, i) => (
                        <div key={i} className="border border-rose-500/80 bg-rose-500/5" />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-7 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">
                      분할 여백 미세 조정
                    </h3>
                    <button
                      type="button"
                      onClick={() => setMargins(DEFAULT_SLICE_MARGINS)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-900"
                    >
                      기본값 초기화
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {[
                      { key: 'topPct', label: '위쪽 여백 (%)', max: 30 },
                      { key: 'bottomPct', label: '아래쪽 여백 (%)', max: 30 },
                      { key: 'leftPct', label: '왼쪽 여백 (%)', max: 25 },
                      { key: 'rightPct', label: '오른쪽 여백 (%)', max: 25 },
                      { key: 'gapXPct', label: '가로 카드 간격 (%)', max: 10 },
                      { key: 'gapYPct', label: '세로 카드 간격 (%)', max: 10 },
                    ].map(({ key, label, max }) => (
                      <label key={key} className="block bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="flex justify-between font-semibold text-slate-700 mb-1">
                          <span>{label}</span>
                          <span className="font-mono-num">
                            {margins[key as keyof SliceMargins]}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={max}
                          step={0.5}
                          value={margins[key as keyof SliceMargins]}
                          onChange={(e) =>
                            setMargins((prev) => ({
                              ...prev,
                              [key]: Number(e.target.value),
                            }))
                          }
                          className="w-full accent-emerald-700"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 16 Sliced Cards Preview Grid */}
            {draftCards.length === 16 && (
              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">
                  분할된 16장의 카드 미리보기
                </h3>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2.5">
                  {draftCards.map((c) => (
                    <div
                      key={c.index}
                      className="bg-white border border-slate-200 rounded-lg overflow-hidden p-1"
                    >
                      <div className="aspect-[3/4] bg-slate-50 rounded overflow-hidden">
                        <img
                          src={c.imageDataUrl}
                          alt={c.label}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <p className="text-[11px] font-mono-num text-center text-slate-500 mt-1">
                        #{c.index + 1}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {errorMsg && (
            <p className="text-sm font-semibold text-rose-600" role="alert">
              {errorMsg}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || draftCards.length !== 16}
              className="px-6 py-3.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors"
            >
              {busy ? '방 만드는 중...' : '딩고 게임 방 만들기'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // --- Active Room Teacher Console ---
  const phaseTextMap: Record<DingoGroup['phase'], string> = {
    LOBBY: '대기 중',
    VIEWING: '카드 확인',
    DISCARDING: '버리기 중',
    PICKING: '집기 중',
    DINGO_WON: '딩고 달성!',
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 space-y-6">
      {/* Room Selector & Create New */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {rooms.slice(0, 6).map((r) => (
            <button
              key={r.roomCode}
              type="button"
              onClick={() => setSelectedRoomCode(r.roomCode)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap ${
                r.roomCode === activeRoom?.roomCode
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {r.title} · {r.roomCode}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={resettingBusy}
          onClick={handleResetAndCreateNew}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          {resettingBusy ? '기존 내용 삭제 중...' : '새 게임 방 만들기'}
        </button>
      </div>

      {!activeRoom && errorMsg && (
        <p className="text-sm font-semibold text-rose-600" role="alert">
          {errorMsg}
        </p>
      )}

      {activeRoom && (
        <>
          {/* Room Header & Controls */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                <span>
                  {activeRoom.status === 'LOBBY'
                    ? '학생 입장 대기 중'
                    : activeRoom.status === 'PLAYING'
                    ? '게임 진행 중'
                    : '수업 종료됨'}
                </span>
                <span aria-hidden="true">·</span>
                <span>총 {activeRoom.totalGroups}모둠</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num">접속 학생 {totalJoinedStudents}명</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">{activeRoom.title}</h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Big Join Code & Password Box */}
              <div className="flex flex-wrap items-center gap-4 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
                <div>
                  <span className="block text-[11px] font-medium text-slate-500">
                    방 코드
                  </span>
                  <span className="text-xl font-extrabold font-mono-num tracking-widest text-emerald-800">
                    {activeRoom.roomCode}
                  </span>
                </div>
                {roomPassword && (
                  <div className="pl-4 border-l border-slate-200">
                    <span className="block text-[11px] font-medium text-slate-500">
                      입장 비밀번호
                    </span>
                    <span className="text-xl font-extrabold font-mono-num text-slate-900">
                      {roomPassword}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleCopyInviteLink}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-700 whitespace-nowrap"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      링크 복사됨
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      학생 링크 복사
                    </>
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowDeckModal((v) => !v)}
                className="inline-flex items-center gap-1.5 px-4 py-3 text-sm font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl whitespace-nowrap"
              >
                <FileImage className="w-4 h-4" />
                카드 16장 보기
              </button>

              {activeRoom.status === 'LOBBY' && (
                <button
                  type="button"
                  disabled={busy || totalJoinedStudents === 0}
                  onClick={handleStartGame}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-sm transition-colors whitespace-nowrap"
                >
                  <Play className="w-4 h-4" />
                  게임 시작하기
                </button>
              )}

              {activeRoom.status === 'PLAYING' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleEndRoom}
                  className="inline-flex items-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-sm font-semibold rounded-xl whitespace-nowrap"
                >
                  <Square className="w-4 h-4" />
                  수업 종료
                </button>
              )}
            </div>
          </div>

          {errorMsg && (
            <p className="text-sm font-semibold text-rose-600" role="alert">
              {errorMsg}
            </p>
          )}

          {/* Collapsible 16-card deck viewer */}
          {showDeckModal && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-900">등록된 16장 딩고 카드</h2>
                <button
                  type="button"
                  onClick={() => setShowDeckModal(false)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  닫기
                </button>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
                {roomCards.map((c) => (
                  <div
                    key={c.index}
                    className="border border-slate-200 rounded-lg p-1 bg-slate-50"
                  >
                    <div className="aspect-[3/4] bg-white rounded overflow-hidden">
                      <img
                        src={c.imageDataUrl}
                        alt={c.label}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Group Monitoring Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {groups.map((g) => {
              const groupPlayers = playersByGroup[g.groupNumber] ?? [];
              const host = groupPlayers.find((p) => p.id === g.hostPlayerId);

              return (
                <div
                  key={g.groupNumber}
                  className={`bg-white border rounded-2xl p-5 flex flex-col justify-between gap-4 ${
                    g.phase === 'DINGO_WON'
                      ? 'border-amber-400 ring-2 ring-amber-200'
                      : 'border-slate-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">
                          {g.groupNumber}모둠
                        </h3>
                        <p className="text-xs text-slate-500">
                          {groupPlayers.length}명
                          {groupPlayers.length === 5
                            ? ' (진행 1 · 게임 4)'
                            : groupPlayers.length === 4
                            ? ' (4명 게임)'
                            : ''}
                          {g.roundNumber > 0 && ` · 라운드 ${g.roundNumber}`}
                        </p>
                      </div>

                      <span
                        className={`text-xs font-bold ${
                          g.phase === 'DINGO_WON'
                            ? 'text-amber-600'
                            : g.phase === 'LOBBY'
                            ? 'text-slate-500'
                            : 'text-emerald-700'
                        }`}
                      >
                        {phaseTextMap[g.phase]}
                      </span>
                    </div>

                    {/* Winner banner */}
                    {g.phase === 'DINGO_WON' && (
                      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-amber-900">
                          딩고 우승: {g.winnerNickname}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void startNextRoundForGroup(
                              activeRoom.roomCode,
                              g.groupNumber,
                              g,
                              groupPlayers
                            )
                          }
                          className="px-2.5 py-1 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg whitespace-nowrap"
                        >
                          다음 라운드
                        </button>
                      </div>
                    )}

                    {/* Joined students */}
                    <div className="mt-3 space-y-2">
                      {groupPlayers.length === 0 ? (
                        <p className="text-xs text-slate-400 py-4 text-center">
                          아직 들어온 학생이 없습니다
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {groupPlayers.map((p) => {
                            const isGroupHost = p.id === g.hostPlayerId;
                            return (
                              <li
                                key={p.id}
                                className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg text-sm"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-semibold text-slate-800 truncate">
                                    {p.nickname}
                                  </span>
                                  {isGroupHost && (
                                    <span className="text-[11px] font-bold text-emerald-700 shrink-0">
                                      진행자
                                    </span>
                                  )}
                                  {p.isBot && (
                                    <span className="text-[11px] text-slate-400 shrink-0">
                                      연습생
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {g.phase !== 'LOBBY' && (
                                    <span className="text-xs font-mono-num text-slate-500">
                                      {p.handCount}장
                                    </span>
                                  )}
                                  {activeRoom.status === 'LOBBY' && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void removePlayer(
                                          activeRoom.roomCode,
                                          g.groupNumber,
                                          p.id
                                        )
                                      }
                                      aria-label={`${p.nickname} 내보내기`}
                                      className="p-1 text-slate-400 hover:text-rose-600"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* Group footer actions */}
                  <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    {activeRoom.status === 'LOBBY' && groupPlayers.length < 5 ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            void addPracticeBots(
                              activeRoom.roomCode,
                              g.groupNumber,
                              teacherUid,
                              4
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                        >
                          <Users className="w-3.5 h-3.5" />
                          연습 4명 채우기
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void addPracticeBots(
                              activeRoom.roomCode,
                              g.groupNumber,
                              teacherUid,
                              5
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                        >
                          5명
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {host ? `진행: ${host.nickname}` : '대기 중'}
                      </span>
                    )}

                    {groupPlayers.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setPreviewGroupNum(g.groupNumber)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg whitespace-nowrap"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        모둠 화면 보기
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
