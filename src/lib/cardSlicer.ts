import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { SlicedCardDraft } from '../types/dingo';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface SliceMargins {
  topPct: number;
  bottomPct: number;
  leftPct: number;
  rightPct: number;
  gapXPct: number;
  gapYPct: number;
}

export const DEFAULT_SLICE_MARGINS: SliceMargins = {
  topPct: 2,
  bottomPct: 2,
  leftPct: 2,
  rightPct: 2,
  gapXPct: 1.5,
  gapYPct: 1.5,
};

export async function renderFileToSourceCanvas(file: File): Promise<HTMLCanvasElement> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetScale = Math.min(2.5, Math.max(1.5, 1800 / baseViewport.width));
    const viewport = page.getViewport({ scale: targetScale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('캔버스 컨텍스트를 생성할 수 없습니다.');
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      canvas,
    }).promise;

    return canvas;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('이미지 파일을 읽는 중 오류가 발생했습니다.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 2200;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('캔버스 컨텍스트를 생성할 수 없습니다.'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error('JPG 또는 PNG 이미지를 불러올 수 없습니다.'));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function sliceCanvasInto16Cards(
  sourceCanvas: HTMLCanvasElement,
  margins: SliceMargins
): SlicedCardDraft[] {
  const cols = 4;
  const rows = 4;

  const usableLeft = (margins.leftPct / 100) * sourceCanvas.width;
  const usableTop = (margins.topPct / 100) * sourceCanvas.height;
  const usableWidth =
    sourceCanvas.width * (1 - (margins.leftPct + margins.rightPct) / 100);
  const usableHeight =
    sourceCanvas.height * (1 - (margins.topPct + margins.bottomPct) / 100);

  const gapX = (margins.gapXPct / 100) * usableWidth;
  const gapY = (margins.gapYPct / 100) * usableHeight;

  const cellW = Math.max(20, (usableWidth - gapX * (cols - 1)) / cols);
  const cellH = Math.max(20, (usableHeight - gapY * (rows - 1)) / rows);

  const maxCardW = 360;
  const outputScale = Math.min(1, maxCardW / cellW);
  const outW = Math.max(120, Math.round(cellW * outputScale));
  const outH = Math.max(120, Math.round(cellH * outputScale));

  const cards: SlicedCardDraft[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const sx = Math.round(usableLeft + c * (cellW + gapX));
      const sy = Math.round(usableTop + r * (cellH + gapY));

      const tile = document.createElement('canvas');
      tile.width = outW;
      tile.height = outH;
      const ctx = tile.getContext('2d');
      if (!ctx) continue;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(sourceCanvas, sx, sy, cellW, cellH, 0, 0, outW, outH);

      const imageDataUrl = tile.toDataURL('image/jpeg', 0.78);
      cards.push({
        index: idx,
        label: `카드 ${idx + 1}`,
        groupTag: r + 1,
        imageDataUrl,
      });
    }
  }

  return cards;
}

const SAMPLE_SETS = [
  {
    groupTag: 1,
    category: '과일 모음',
    accent: '#DC2626',
    bg: '#FEF2F2',
    items: ['사과', '딸기', '수박', '체리'],
  },
  {
    groupTag: 2,
    category: '동물 친구',
    accent: '#059669',
    bg: '#ECFDF5',
    items: ['강아지', '고양이', '토끼', '다람쥐'],
  },
  {
    groupTag: 3,
    category: '자연과 날씨',
    accent: '#0284C7',
    bg: '#F0F9FF',
    items: ['햇님', '구름', '무지개', '눈송이'],
  },
  {
    groupTag: 4,
    category: '악기 연주',
    accent: '#D97706',
    bg: '#FFFBEB',
    items: ['피아노', '바이올린', '실로폰', '탬버린'],
  },
];

export function generateSampleDeck(): SlicedCardDraft[] {
  const cards: SlicedCardDraft[] = [];

  SAMPLE_SETS.forEach((set, rowIdx) => {
    set.items.forEach((item, colIdx) => {
      const idx = rowIdx * 4 + colIdx;
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 300, 400);

      ctx.fillStyle = set.bg;
      ctx.fillRect(18, 18, 264, 364);

      ctx.strokeStyle = set.accent;
      ctx.lineWidth = 6;
      ctx.strokeRect(18, 18, 264, 364);

      ctx.fillStyle = set.accent;
      ctx.font = 'bold 20px "Noto Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(set.category, 150, 74);

      ctx.beginPath();
      ctx.arc(150, 190, 62, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = set.accent;
      ctx.stroke();

      ctx.fillStyle = set.accent;
      ctx.font = '800 32px "Noto Sans KR", sans-serif';
      ctx.fillText(String(colIdx + 1), 150, 202);

      ctx.fillStyle = '#0F172A';
      ctx.font = '800 34px "Noto Sans KR", sans-serif';
      ctx.fillText(item, 150, 315);

      ctx.fillStyle = '#64748B';
      ctx.font = '600 15px "Noto Sans KR", sans-serif';
      ctx.fillText(`${set.category} 4장 모으기`, 150, 352);

      cards.push({
        index: idx,
        label: `${set.category} - ${item}`,
        groupTag: set.groupTag,
        imageDataUrl: canvas.toDataURL('image/jpeg', 0.82),
      });
    });
  });

  return cards;
}
