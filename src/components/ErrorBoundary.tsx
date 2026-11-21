import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || '예기치 않은 오류가 발생했습니다.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (parsed?.error) {
          friendly = `데이터 처리 중 권한 또는 연결 오류가 발생했습니다. (${parsed.operationType ?? 'read'} · ${parsed.path ?? ''})`;
        }
      } catch {
        // plain message
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F7F6F2] p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center">
            <h2 className="text-xl font-bold text-slate-900 mb-3">
              화면을 불러오는 중 문제가 발생했습니다
            </h2>
            <p className="text-sm text-slate-600 mb-6 break-words">{friendly}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 transition-colors"
            >
              새로고침하기
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
