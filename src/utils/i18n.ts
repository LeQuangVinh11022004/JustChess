import type {
  GamePhase,
  MoveClassification,
  PhaseGrade,
  TimeControlCategory,
} from '../engine/gameReview'

export type Language = 'vi' | 'en'

const STORAGE_KEY = 'justchess-lang'

export function getInitialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'vi') return saved
  } catch {
    // Ignore storage errors
  }
  return 'vi'
}

export function saveLanguage(lang: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Ignore storage errors
  }
}

export const CLASSIFICATION_LABEL: Record<
  Language,
  Record<MoveClassification, string>
> = {
  vi: {
    brilliant: 'Thiên tài (Brilliant)',
    great: 'Xuất sắc (Great)',
    best: 'Tốt nhất (Best)',
    excellent: 'Rất tốt (Excellent)',
    good: 'Tốt (Good)',
    book: 'Sách khai cuộc (Book)',
    inaccuracy: 'Thiếu chính xác',
    mistake: 'Sai lầm (Mistake)',
    miss: 'Bỏ lỡ (Miss)',
    blunder: 'Nghiêm trọng (Blunder)',
  },
  en: {
    brilliant: 'Brilliant',
    great: 'Great',
    best: 'Best',
    excellent: 'Excellent',
    good: 'Good',
    book: 'Book',
    inaccuracy: 'Inaccuracy',
    mistake: 'Mistake',
    miss: 'Miss',
    blunder: 'Blunder',
  },
}

export const PHASE_GRADE_LABEL: Record<Language, Record<PhaseGrade, string>> = {
  vi: {
    excellent: 'Xuất sắc',
    good: 'Tốt',
    okay: 'Ổn',
    weak: 'Yếu',
    poor: 'Kém',
  },
  en: {
    excellent: 'Excellent',
    good: 'Good',
    okay: 'Okay',
    weak: 'Weak',
    poor: 'Poor',
  },
}

export const PHASE_LABEL: Record<Language, Record<GamePhase, string>> = {
  vi: {
    opening: 'Khai cuộc',
    middlegame: 'Trung cuộc',
    endgame: 'Tàn cuộc',
  },
  en: {
    opening: 'Opening',
    middlegame: 'Middlegame',
    endgame: 'Endgame',
  },
}

export const TIME_CONTROL_LABEL: Record<
  Language,
  Record<TimeControlCategory, string>
> = {
  vi: {
    bullet: 'Bullet (< 3 phút)',
    blitz: 'Blitz (3–8 phút)',
    rapid: 'Rapid (8–25 phút)',
    classical: 'Classical (≥ 25 phút)',
  },
  en: {
    bullet: 'Bullet (< 3 min)',
    blitz: 'Blitz (3–8 min)',
    rapid: 'Rapid (8–25 min)',
    classical: 'Classical (≥ 25 min)',
  },
}
