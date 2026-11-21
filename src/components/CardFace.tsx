import { useState } from 'react';
import type { DingoCard } from '../types/dingo';

export function CardFace({
  card,
  selected = false,
  selectable = false,
  onClick,
  badgeText,
  className = '',
}: {
  card?: DingoCard;
  selected?: boolean;
  selectable?: boolean;
  onClick?: () => void;
  badgeText?: string;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);

  const containerClass = `relative aspect-[3/4] w-full rounded-xl bg-white overflow-hidden transition-transform duration-150 select-none ${
    selected
      ? 'ring-4 ring-rose-500 -translate-y-2 shadow-xl'
      : 'border border-slate-200 shadow-md'
  } ${
    selectable
      ? 'cursor-pointer hover:-translate-y-1.5 hover:shadow-lg active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400'
      : ''
  } ${className}`;

  const inner = (
    <div className="w-full h-full flex flex-col bg-white">
      <div className="flex-1 relative bg-slate-50 overflow-hidden">
        {card?.imageDataUrl && !imgError ? (
          <img
            src={card.imageDataUrl}
            alt={card.label || `딩고 카드 ${card.index + 1}`}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-contain bg-white"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-gradient-to-br from-emerald-50 to-slate-100">
            <span className="text-lg font-bold text-slate-800">
              {card ? card.label : '카드'}
            </span>
          </div>
        )}
      </div>

      {badgeText && (
        <div className="px-2 py-1 bg-rose-600 text-white text-xs font-bold text-center truncate">
          {badgeText}
        </div>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={containerClass}>
        {inner}
      </button>
    );
  }

  return <div className={containerClass}>{inner}</div>;
}
