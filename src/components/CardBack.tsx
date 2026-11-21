export function CardBack({
  label,
  interactive = false,
  disabled = false,
  onClick,
  className = '',
}: {
  label?: string;
  interactive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const baseClass = `relative aspect-[3/4] w-full rounded-xl bg-[#FAF8F2] p-1.5 shadow-md select-none transition-transform duration-150 ${
    interactive && !disabled
      ? 'cursor-pointer hover:-translate-y-1.5 hover:shadow-xl active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400'
      : ''
  } ${disabled ? 'opacity-60 cursor-default' : ''} ${className}`;

  const content = (
    <div className="w-full h-full rounded-lg bg-[#0D3B2A] border border-amber-300/40 relative overflow-hidden flex items-center justify-center">
      <svg
        className="absolute inset-0 w-full h-full opacity-25"
        xmlns="http://www.w3.org/2000/svg"
        width="100%"
        height="100%"
      >
        <defs>
          <pattern id="dingo-lattice" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M 10 0 L 20 10 L 10 20 L 0 10 Z"
              fill="none"
              stroke="#FCD34D"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dingo-lattice)" />
      </svg>

      <div className="relative z-10 flex flex-col items-center justify-center gap-1.5 px-2 text-center">
        <div className="w-9 h-9 rounded-full border border-amber-300/60 bg-[#0A2D20] flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            className="w-5 h-5 text-amber-300"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
          </svg>
        </div>
        {label && (
          <span className="text-xs font-bold tracking-wider text-amber-200">{label}</span>
        )}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={baseClass}
      >
        {content}
      </button>
    );
  }

  return <div className={baseClass}>{content}</div>;
}
