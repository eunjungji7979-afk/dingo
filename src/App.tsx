import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TeacherDashboard } from './components/TeacherDashboard';
import { StudentArena } from './components/StudentArena';

type ViewMode = 'home' | 'teacher' | 'student' | 'rules';

function getOrCreateStudentId(): string {
  const key = 'dingo_student_guest_id';
  try {
    const existing = window.localStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
      return existing;
    }
    const rand =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 18)
        : Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
    const created = `stu_${rand}`;
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return `stu_${Date.now().toString(36)}`;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [studentGuestId] = useState<string>(() => getOrCreateStudentId());

  const [initialRoomCode, setInitialRoomCode] = useState('');
  const [view, setView] = useState<ViewMode>('home');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room')?.trim().toUpperCase() ?? '';
    if (/^[A-Z0-9]{4,10}$/.test(roomParam)) {
      setInitialRoomCode(roomParam);
      setView('student');
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const handleSignIn = async () => {
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google 로그인에 실패했습니다. 팝업 차단을 확인해 주세요.'
      );
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setView('home');
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col bg-[#F7F6F2] text-slate-900">
        {/* 3-Zone Top Bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
            <button
              type="button"
              onClick={() => setView('home')}
              className="text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 hover:text-emerald-800 transition-colors"
            >
              딩고 클래스
            </button>

            <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setView('home')}
                className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                  view === 'home' ? 'text-slate-900 underline underline-offset-4' : ''
                }`}
              >
                홈
              </button>
              <button
                type="button"
                onClick={() => setView('teacher')}
                className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                  view === 'teacher' ? 'text-emerald-800 underline underline-offset-4' : ''
                }`}
              >
                교사용
              </button>
              <button
                type="button"
                onClick={() => setView('student')}
                className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                  view === 'student' ? 'text-emerald-800 underline underline-offset-4' : ''
                }`}
              >
                학생용
              </button>
              <button
                type="button"
                onClick={() => setView('rules')}
                className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                  view === 'rules' ? 'text-slate-900 underline underline-offset-4' : ''
                }`}
              >
                게임 규칙
              </button>
            </nav>

            <div className="flex items-center gap-3 shrink-0">
              {!authReady ? (
                <span className="text-xs text-slate-400 whitespace-nowrap">확인 중</span>
              ) : user ? (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  로그아웃
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Google 로그인
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Quick Nav */}
        <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-around text-xs font-semibold text-slate-600">
          <button
            type="button"
            onClick={() => setView('home')}
            className={`py-1.5 px-3 rounded-lg whitespace-nowrap ${
              view === 'home' ? 'bg-slate-100 text-slate-900' : ''
            }`}
          >
            홈
          </button>
          <button
            type="button"
            onClick={() => setView('teacher')}
            className={`py-1.5 px-3 rounded-lg whitespace-nowrap ${
              view === 'teacher' ? 'bg-emerald-50 text-emerald-800' : ''
            }`}
          >
            교사용
          </button>
          <button
            type="button"
            onClick={() => setView('student')}
            className={`py-1.5 px-3 rounded-lg whitespace-nowrap ${
              view === 'student' ? 'bg-emerald-50 text-emerald-800' : ''
            }`}
          >
            학생용
          </button>
          <button
            type="button"
            onClick={() => setView('rules')}
            className={`py-1.5 px-3 rounded-lg whitespace-nowrap ${
              view === 'rules' ? 'bg-slate-100 text-slate-900' : ''
            }`}
          >
            규칙
          </button>
        </div>

        {/* Main Content */}
        <main className="flex-1">
          {view === 'home' && (
            <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 space-y-14">
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
                <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-emerald-800">
                      교실 모둠 실시간 카드 게임
                    </p>
                    <h1
                      className="text-4xl sm:text-5xl font-extrabold text-slate-900 leading-tight"
                      style={{ textWrap: 'balance' }}
                    >
                      16장의 카드로 즐기는 우리 반 딩고 게임
                    </h1>
                    <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                      교사가 1장의 PDF 또는 JPG 학습지를 올리면 자동으로 16장의 카드로 분할됩니다.
                      모둠별로 접속해 &ldquo;버려!&rdquo;와 &ldquo;집어!&rdquo;를 외치며 4장의 짝을 완성해 보세요.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setView('teacher')}
                      className="px-6 py-3.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm rounded-xl shadow-sm transition-colors whitespace-nowrap"
                    >
                      교사용 화면 열기
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('student')}
                      className="px-6 py-3.5 bg-white hover:bg-slate-50 text-slate-900 border border-slate-300 font-bold text-sm rounded-xl transition-colors whitespace-nowrap"
                    >
                      학생 모둠 입장하기
                    </button>
                  </div>

                  {authError && (
                    <p className="text-sm text-rose-600 font-medium">{authError}</p>
                  )}
                </div>

                <div className="lg:col-span-5">
                  <div className="h-full min-h-[280px] rounded-2xl overflow-hidden border border-slate-200 bg-[#0E4D36] flex items-center justify-center p-6">
                    <img
                      src="/src/assets/images/dingo_card_back_1795249589861.jpg"
                      alt="딩고 클래스 테이블 카드 디자인"
                      referrerPolicy="no-referrer"
                      className="w-full max-w-[240px] aspect-[3/4] object-cover rounded-xl shadow-2xl"
                    />
                  </div>
                </div>
              </section>

              {/* 4-Step Flow Overview */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 pt-4 border-t border-slate-200">
                {[
                  {
                    step: '01. 교사 카드 준비',
                    desc: '모둠 수를 정하고 16칸 PDF 또는 JPG 파일 1장을 올리면 즉시 16장 카드로 잘립니다.',
                  },
                  {
                    step: '02. 모둠 입장 및 시작',
                    desc: '학생들이 모둠 번호와 닉네임을 입력해 들어오면 교사가 확인 후 게임을 시작합니다.',
                  },
                  {
                    step: '03. 버려! 와 집어!',
                    desc: '진행자가 버려!를 누르면 1장씩 뒤집어 가운데 모으고, 집어!를 누르면 1장씩 가져갑니다.',
                  },
                  {
                    step: '04. 딩고와 진행자 교대',
                    desc: '4장 세트를 완성하면 딩고! 버튼과 함께 폭죽이 터지고, 카드를 섞어 다음 진행자가 이어갑니다.',
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="bg-white border border-slate-200 rounded-2xl p-6 space-y-2"
                  >
                    <h2 className="text-base font-bold text-slate-900">{item.step}</h2>
                    <p className="text-sm text-slate-600 leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </section>
            </div>
          )}

          {view === 'rules' && (
            <div className="max-w-3xl mx-auto py-12 px-4 sm:px-6 space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-8 space-y-6">
                <h1 className="text-2xl font-bold text-slate-900">딩고 게임 진행 규칙</h1>

                <div className="space-y-4 text-sm text-slate-700 leading-relaxed">
                  <div>
                    <h2 className="font-bold text-slate-900 mb-1">1. 카드 배분 (총 16장)</h2>
                    <p>
                      게임이 시작되면 모둠당 16장의 카드가 무작위로 섞여 각 학생에게 4장씩 배분됩니다.
                      모둠에 5명이 참여할 경우, 1명이 전담 진행자를 맡고 나머지 4명이 각 4장씩 카드를 들고 게임합니다.
                    </p>
                  </div>

                  <div>
                    <h2 className="font-bold text-slate-900 mb-1">2. 버려! (뒤집힌 카드 모으기)</h2>
                    <p>
                      학생들이 자신의 4장을 확인한 뒤, 진행자가 [버려!] 버튼을 누르면 각자 필요 없는 카드 1장을 선택해 버립니다.
                      버려진 4장의 카드는 뒤집힌 채로 화면 가운데에 모입니다.
                    </p>
                  </div>

                  <div>
                    <h2 className="font-bold text-slate-900 mb-1">3. 집어! (1장씩 가져오기)</h2>
                    <p>
                      가운데 4장의 카드가 모두 모이면 진행자가 [집어!] 버튼을 누릅니다.
                      게임하는 학생들은 뒤집힌 카드 중 1장씩 골라 자신의 손패로 가져갑니다.
                    </p>
                  </div>

                  <div>
                    <h2 className="font-bold text-slate-900 mb-1">4. 딩고! 및 다음 라운드</h2>
                    <p>
                      같은 주제나 짝이 맞는 4장의 카드를 모은 학생이 [딩고!] 버튼을 누르면 폭죽이 터지며 우승 카드 4장이 공개됩니다.
                      이후 해당 모둠은 카드를 다시 섞어 배분하고, 다음 사람이 새로운 진행자가 되어 새 라운드를 진행합니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'teacher' && !authReady && (
            <div className="max-w-md mx-auto py-20 px-4 text-center text-sm text-slate-500">
              로그인 상태를 확인하고 있습니다...
            </div>
          )}

          {view === 'teacher' && authReady && !user && (
            <div className="max-w-md mx-auto py-16 px-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-5 shadow-sm">
                <h2 className="text-xl font-bold text-slate-900">교사 계정으로 로그인</h2>
                <p className="text-sm text-slate-600">
                  수업 방을 만들고 16장의 카드를 안전하게 저장하기 위해 교사는 Google 로그인이 필요합니다.
                  (학생들은 구글 로그인 없이 링크와 비밀번호만으로 입장합니다.)
                </p>

                {authError && (
                  <p className="text-xs font-medium text-rose-600">{authError}</p>
                )}

                <button
                  type="button"
                  onClick={handleSignIn}
                  className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm rounded-xl transition-colors"
                >
                  Google 계정으로 계속하기
                </button>
              </div>
            </div>
          )}

          {view === 'teacher' && authReady && user && (
            <TeacherDashboard teacherUid={user.uid} />
          )}

          {view === 'student' && (
            <StudentArena
              uid={studentGuestId}
              initialRoomCode={initialRoomCode}
            />
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}
