import { LunarMonth, LunarYear, Solar } from 'lunar-javascript';

export const SUPPORTED_SOLAR_YEAR_MIN = 1900 as const;
export const SUPPORTED_SOLAR_YEAR_MAX = 2100 as const;

export function isSolarYearInLunarSupportedRange(year: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= SUPPORTED_SOLAR_YEAR_MIN &&
    year <= SUPPORTED_SOLAR_YEAR_MAX
  );
}

export interface LunarAndHolidayProvenance {
  readonly lunarEngine: {
    readonly packageName: 'lunar-javascript';
    readonly version: '1.7.7';
    readonly license: 'MIT';
    readonly supportedSolarYearRange: readonly [1900, 2100];
    readonly capabilities: readonly string[];
  };
  readonly officialHolidaySource: {
    readonly authority: string;
    readonly referenceUrl: string;
    readonly datasetVersion: string;
    readonly lastUpdatedDate: string;
    readonly staticCoverageYears: readonly number[];
    readonly maintenanceNote: string;
    readonly fallbackPolicy: string;
    readonly disclaimer: string;
  };
  readonly mvpScopeBoundary: {
    readonly supportsLunarDisplay: true;
    readonly supportsLeapMonthDisplay: true;
    readonly supportsSolarTerms: true;
    readonly supportsTraditionalFestivals: true;
    readonly supportsLunarRecurringSchedule: false;
    readonly nonGoalNotice: string;
  };
}

/**
 * Explicit data provenance, license verification, and MVP boundary disclosure (Issue #6 / Review D5 / PR #26 Follow-up).
 * Ensures the UI and callers never misrepresent simple lunar calendar display as lunar recurring event scheduling,
 * nor misrepresent the static holiday reference summary as the complete dynamic government work calendar.
 */
export const LUNAR_AND_HOLIDAY_PROVENANCE: LunarAndHolidayProvenance = {
  lunarEngine: {
    packageName: 'lunar-javascript',
    version: '1.7.7',
    license: 'MIT',
    supportedSolarYearRange: [SUPPORTED_SOLAR_YEAR_MIN, SUPPORTED_SOLAR_YEAR_MAX],
    capabilities: [
      '西曆與農曆年月日離線對照（1900–2100）',
      '農曆閏月識別（區分正統月份與閏月，如「六月」與「閏六月」）',
      '二十四節氣定氣法計算與繁體中文轉換',
      '干支紀年、生肖與傳統農曆節日（含臘月大小月動態除夕判定）',
    ],
  },
  officialHolidaySource: {
    authority:
      '行政院人事行政總處（DGPA）政府行政機關辦公日曆表及紀念日及節日實施條例靜態參考資料（2025–2027）',
    referenceUrl: 'https://www.dgpa.gov.tw/information?uid=41',
    datasetVersion: 'dgpa-static-summary-2025-2027.v1',
    lastUpdatedDate: '2026-10-30',
    staticCoverageYears: [2025, 2026, 2027],
    maintenanceNote:
      '本靜態資料僅摘錄重點國定假日與調整放假摘要，不代表完整官方辦公日曆表（未涵蓋補行上班日或臨時停班停課）；每年應依行政院人事行政總處最新核定公告檢核更新。',
    fallbackPolicy:
      '超出靜態年份範圍時，僅提供固定陽曆紀念日、二十四節氣（如清明）與農曆傳統節日推算，不涵蓋跨年彈性放假或補行上班公告；超出 1900–2100 農曆引擎支援年份時自動安全降級顯示。',
    disclaimer:
      '節假日與農曆資訊僅供參考（非完整官方辦公日曆），實際放假與補班規定以行政院人事行政總處最新公告為準。',
  },
  mvpScopeBoundary: {
    supportsLunarDisplay: true,
    supportsLeapMonthDisplay: true,
    supportsSolarTerms: true,
    supportsTraditionalFestivals: true,
    supportsLunarRecurringSchedule: false,
    nonGoalNotice:
      'MVP 僅提供西曆對照農曆、二十四節氣與節慶顯示；暫不支援農曆每年重複事件排程（含閏月週期排程）。',
  },
} as const;

const LUNAR_MONTH_NAMES_ZH_TW: Record<number, string> = {
  1: '正月',
  2: '二月',
  3: '三月',
  4: '四月',
  5: '五月',
  6: '六月',
  7: '七月',
  8: '八月',
  9: '九月',
  10: '十月',
  11: '十一月',
  12: '臘月',
};

const LUNAR_DAY_NAMES_ZH_TW: readonly string[] = [
  '',
  '初一',
  '初二',
  '初三',
  '初四',
  '初五',
  '初六',
  '初七',
  '初八',
  '初九',
  '初十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十',
] as const;

const ZODIAC_SIMPLIFIED_TO_ZH_TW: Record<string, string> = {
  鼠: '鼠',
  牛: '牛',
  虎: '虎',
  兔: '兔',
  龙: '龍',
  龍: '龍',
  蛇: '蛇',
  马: '馬',
  馬: '馬',
  羊: '羊',
  猴: '猴',
  鸡: '雞',
  雞: '雞',
  狗: '狗',
  猪: '豬',
  豬: '豬',
};

/**
 * All 24 Solar Terms mapped from `lunar-javascript` Simplified Chinese output to Traditional Chinese (`zh-TW`).
 */
export const SOLAR_TERMS_ZH_TW_MAP: Record<string, string> = {
  立春: '立春',
  雨水: '雨水',
  惊蛰: '驚蟄',
  驚蟄: '驚蟄',
  春分: '春分',
  清明: '清明',
  谷雨: '穀雨',
  穀雨: '穀雨',
  立夏: '立夏',
  小满: '小滿',
  小滿: '小滿',
  芒种: '芒種',
  芒種: '芒種',
  夏至: '夏至',
  小暑: '小暑',
  大暑: '大暑',
  立秋: '立秋',
  处暑: '處暑',
  處暑: '處暑',
  白露: '白露',
  秋分: '秋分',
  寒露: '寒露',
  霜降: '霜降',
  立冬: '立冬',
  小雪: '小雪',
  大雪: '大雪',
  冬至: '冬至',
  小寒: '小寒',
  大寒: '大寒',
};

export const ALL_24_SOLAR_TERMS_ZH_TW: readonly string[] = [
  '立春',
  '雨水',
  '驚蟄',
  '春分',
  '清明',
  '穀雨',
  '立夏',
  '小滿',
  '芒種',
  '夏至',
  '小暑',
  '大暑',
  '立秋',
  '處暑',
  '白露',
  '秋分',
  '寒露',
  '霜降',
  '立冬',
  '小雪',
  '大雪',
  '冬至',
  '小寒',
  '大寒',
] as const;

export interface TaiwanHolidayEntry {
  readonly name: string;
  readonly isDayOff: boolean;
  readonly category: 'national_holiday' | 'adjusted_day_off' | 'commemorative';
}

/**
 * Static reference table for Taiwan official holidays and adjusted days off (2025–2027).
 * Source: DGPA (行政院人事行政總處政府行政機關辦公日曆表) & National Holidays Act.
 * Note: For reference only; actual days off depend on official government announcements.
 */
export const TAIWAN_OFFICIAL_HOLIDAYS_BY_DATE: Readonly<
  Record<string, TaiwanHolidayEntry>
> = {
  // 2025 key holidays
  '2025-01-01': { name: '元旦', isDayOff: true, category: 'national_holiday' },
  '2025-01-27': { name: '小年夜調整放假', isDayOff: true, category: 'adjusted_day_off' },
  '2025-01-28': { name: '除夕', isDayOff: true, category: 'national_holiday' },
  '2025-01-29': { name: '春節', isDayOff: true, category: 'national_holiday' },
  '2025-01-30': { name: '春節初二', isDayOff: true, category: 'national_holiday' },
  '2025-01-31': { name: '春節初三', isDayOff: true, category: 'national_holiday' },
  '2025-02-28': { name: '和平紀念日', isDayOff: true, category: 'national_holiday' },
  '2025-04-03': { name: '兒童節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2025-04-04': { name: '兒童節／民族掃墓節', isDayOff: true, category: 'national_holiday' },
  '2025-05-01': { name: '勞動節', isDayOff: true, category: 'national_holiday' },
  '2025-05-30': { name: '端午節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2025-05-31': { name: '端午節', isDayOff: true, category: 'national_holiday' },
  '2025-09-28': { name: '教師節', isDayOff: true, category: 'national_holiday' },
  '2025-09-29': { name: '教師節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2025-10-06': { name: '中秋節', isDayOff: true, category: 'national_holiday' },
  '2025-10-10': { name: '國慶日', isDayOff: true, category: 'national_holiday' },
  '2025-10-24': { name: '臺灣光復節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2025-10-25': { name: '臺灣光復節', isDayOff: true, category: 'national_holiday' },
  '2025-12-25': { name: '行憲紀念日', isDayOff: true, category: 'national_holiday' },

  // 2026 key holidays
  '2026-01-01': { name: '元旦', isDayOff: true, category: 'national_holiday' },
  '2026-02-15': { name: '小年夜', isDayOff: true, category: 'national_holiday' },
  '2026-02-16': { name: '除夕', isDayOff: true, category: 'national_holiday' },
  '2026-02-17': { name: '春節', isDayOff: true, category: 'national_holiday' },
  '2026-02-18': { name: '春節初二', isDayOff: true, category: 'national_holiday' },
  '2026-02-19': { name: '春節初三', isDayOff: true, category: 'national_holiday' },
  '2026-02-20': { name: '春節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2026-02-27': { name: '和平紀念日補假', isDayOff: true, category: 'adjusted_day_off' },
  '2026-02-28': { name: '和平紀念日', isDayOff: true, category: 'national_holiday' },
  '2026-04-03': { name: '兒童節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2026-04-04': { name: '兒童節', isDayOff: true, category: 'national_holiday' },
  '2026-04-05': { name: '民族掃墓節', isDayOff: true, category: 'national_holiday' },
  '2026-04-06': { name: '民族掃墓節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2026-05-01': { name: '勞動節', isDayOff: true, category: 'national_holiday' },
  '2026-06-19': { name: '端午節', isDayOff: true, category: 'national_holiday' },
  '2026-09-25': { name: '中秋節', isDayOff: true, category: 'national_holiday' },
  '2026-09-28': { name: '教師節', isDayOff: true, category: 'national_holiday' },
  '2026-10-09': { name: '國慶日補假', isDayOff: true, category: 'adjusted_day_off' },
  '2026-10-10': { name: '國慶日', isDayOff: true, category: 'national_holiday' },
  '2026-10-25': { name: '臺灣光復節', isDayOff: true, category: 'national_holiday' },
  '2026-10-26': { name: '臺灣光復節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2026-12-25': { name: '行憲紀念日', isDayOff: true, category: 'national_holiday' },

  // 2027 key holidays
  '2027-01-01': { name: '元旦', isDayOff: true, category: 'national_holiday' },
  '2027-02-04': { name: '小年夜', isDayOff: true, category: 'national_holiday' },
  '2027-02-05': { name: '除夕', isDayOff: true, category: 'national_holiday' },
  '2027-02-06': { name: '春節', isDayOff: true, category: 'national_holiday' },
  '2027-02-07': { name: '春節初二', isDayOff: true, category: 'national_holiday' },
  '2027-02-08': { name: '春節初三', isDayOff: true, category: 'national_holiday' },
  '2027-02-09': { name: '春節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2027-02-10': { name: '春節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2027-02-28': { name: '和平紀念日', isDayOff: true, category: 'national_holiday' },
  '2027-03-01': { name: '和平紀念日補假', isDayOff: true, category: 'adjusted_day_off' },
  '2027-04-04': { name: '兒童節', isDayOff: true, category: 'national_holiday' },
  '2027-04-05': { name: '民族掃墓節', isDayOff: true, category: 'national_holiday' },
  '2027-04-06': { name: '兒童節補假', isDayOff: true, category: 'adjusted_day_off' },
  '2027-05-01': { name: '勞動節', isDayOff: true, category: 'national_holiday' },
  '2027-06-09': { name: '端午節', isDayOff: true, category: 'national_holiday' },
  '2027-09-15': { name: '中秋節', isDayOff: true, category: 'national_holiday' },
  '2027-09-28': { name: '教師節', isDayOff: true, category: 'national_holiday' },
  '2027-10-10': { name: '國慶日', isDayOff: true, category: 'national_holiday' },
  '2027-10-11': { name: '國慶日補假', isDayOff: true, category: 'adjusted_day_off' },
  '2027-10-25': { name: '臺灣光復節', isDayOff: true, category: 'national_holiday' },
  '2027-12-25': { name: '行憲紀念日', isDayOff: true, category: 'national_holiday' },
};

const FIXED_SOLAR_HOLIDAYS_BY_MM_DD: Readonly<Record<string, TaiwanHolidayEntry>> = {
  '01-01': { name: '元旦', isDayOff: true, category: 'national_holiday' },
  '02-28': { name: '和平紀念日', isDayOff: true, category: 'national_holiday' },
  '04-04': { name: '兒童節', isDayOff: true, category: 'national_holiday' },
  '05-01': { name: '勞動節', isDayOff: true, category: 'national_holiday' },
  '09-28': { name: '教師節', isDayOff: true, category: 'national_holiday' },
  '10-10': { name: '國慶日', isDayOff: true, category: 'national_holiday' },
  '10-25': { name: '臺灣光復節', isDayOff: true, category: 'national_holiday' },
  '12-25': { name: '行憲紀念日', isDayOff: true, category: 'national_holiday' },
};

export type LunarCellHighlightKind =
  | 'festival'
  | 'solar_term'
  | 'lunar_first_day'
  | 'normal';

export interface LunarDateInfo {
  dateStr: string; // YYYY-MM-DD
  lunarYear: number;
  lunarMonth: number; // 1..12 (always positive; check isLeapMonth for 閏月)
  lunarDay: number; // 1..30
  isLeapMonth: boolean;
  leapMonthOfYear: number | null; // e.g., 6 in 2025 (乙巳年閏六月), null if no leap month in that lunar year
  lunarMonthDayCount: number; // 29 (小月) or 30 (大月)
  ganZhiYear: string; // e.g., '乙巳', '丙午'
  zodiac: string; // Traditional Chinese, e.g., '蛇', '馬', '龍'
  lunarMonthLabel: string; // e.g., '正月', '六月', '閏六月', '臘月'
  lunarDayLabel: string; // e.g., '初一', '十五', '廿九', '三十'
  fullLunarLabel: string; // e.g., '乙巳年閏六月初一 (蛇年)'
  solarTerm: string | null; // e.g., '立春', '清明', '夏至', '冬至'
  traditionalFestival: string | null; // e.g., '春節', '除夕', '端午節', '中秋節'
  officialHoliday: string | null; // e.g., '和平紀念日', '國慶日', '春節'
  isHolidayDayOff: boolean;
  cellDisplayText: string; // Concise label for month grid cell
  cellHighlightKind: LunarCellHighlightKind;
  isOutOfSupportedRange: boolean; // true when year < 1900 or year > 2100 (safe fallback)
}

function resolveTraditionalLunarFestival(
  solar: Solar,
  lunarMonth: number,
  lunarDay: number,
  isLeapMonth: boolean,
): string | null {
  // Check if tomorrow is Lunar New Year (正月初一, non-leap) -> Today is New Year's Eve (除夕),
  // regardless of whether the 12th lunar month has 29 days (小月) or 30 days (大月).
  try {
    const nextDayLunar = solar.next(1).getLunar();
    if (nextDayLunar.getMonth() === 1 && nextDayLunar.getDay() === 1) {
      return '除夕';
    }
  } catch {
    // At the upper boundary (e.g. 2100-12-31 -> 2101-01-01), solar.next(1) may exceed table bounds
  }

  // Traditional lunar festivals are celebrated on the regular lunar month, not on the leap month (閏月).
  if (isLeapMonth) {
    return null;
  }

  if (lunarMonth === 1 && lunarDay === 1) return '春節';
  if (lunarMonth === 1 && lunarDay === 15) return '元宵節';
  if (lunarMonth === 5 && lunarDay === 5) return '端午節';
  if (lunarMonth === 7 && lunarDay === 7) return '七夕';
  if (lunarMonth === 7 && lunarDay === 15) return '中元節';
  if (lunarMonth === 8 && lunarDay === 15) return '中秋節';
  if (lunarMonth === 9 && lunarDay === 9) return '重陽節';
  if (lunarMonth === 12 && lunarDay === 8) return '臘八節';

  return null;
}

function resolveTaiwanOfficialHoliday(
  dateStr: string,
  solarTerm: string | null,
  traditionalFestival: string | null,
): TaiwanHolidayEntry | null {
  const exactMatch = TAIWAN_OFFICIAL_HOLIDAYS_BY_DATE[dateStr];
  if (exactMatch) {
    return exactMatch;
  }

  const mmDd = dateStr.slice(5);
  const fixedMatch = FIXED_SOLAR_HOLIDAYS_BY_MM_DD[mmDd];
  if (fixedMatch) {
    return fixedMatch;
  }

  if (solarTerm === '清明') {
    return { name: '民族掃墓節', isDayOff: true, category: 'national_holiday' };
  }

  if (
    traditionalFestival === '除夕' ||
    traditionalFestival === '春節' ||
    traditionalFestival === '端午節' ||
    traditionalFestival === '中秋節'
  ) {
    return {
      name: traditionalFestival,
      isDayOff: true,
      category: 'national_holiday',
    };
  }

  return null;
}

function buildOutOfRangeLunarFallback(
  dateStr: string,
  year: number,
  month: number,
  day: number,
): LunarDateInfo {
  const holidayEntry = resolveTaiwanOfficialHoliday(dateStr, null, null);
  const officialHoliday = holidayEntry ? holidayEntry.name : null;
  const isHolidayDayOff = holidayEntry ? holidayEntry.isDayOff : false;

  return {
    dateStr,
    lunarYear: year,
    lunarMonth: month,
    lunarDay: day,
    isLeapMonth: false,
    leapMonthOfYear: null,
    lunarMonthDayCount: 30,
    ganZhiYear: '—',
    zodiac: '—',
    lunarMonthLabel: '超出農曆範圍',
    lunarDayLabel: `${month}/${day}`,
    fullLunarLabel: `西元 ${dateStr}（超出 ${SUPPORTED_SOLAR_YEAR_MIN}–${SUPPORTED_SOLAR_YEAR_MAX} 農曆換算支援範圍）`,
    solarTerm: null,
    traditionalFestival: null,
    officialHoliday,
    isHolidayDayOff,
    cellDisplayText: officialHoliday ?? '—',
    cellHighlightKind: officialHoliday ? 'festival' : 'normal',
    isOutOfSupportedRange: true,
  };
}

/**
 * Computes comprehensive Lunar, 24 Solar Term, Traditional Festival, and Taiwan Official Holiday
 * metadata for a pure local date `YYYY-MM-DD`.
 * Safely degrades without throwing when the year falls outside `lunar-javascript`'s supported range (1900–2100).
 */
export function getLunarDateInfo(dateStr: string): LunarDateInfo {
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid local date string: ${dateStr}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    throw new Error(`Out-of-range month in local date string: ${dateStr}`);
  }
  const maxDaysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDaysInMonth) {
    throw new Error(`Out-of-range local date string: ${dateStr}`);
  }

  if (!isSolarYearInLunarSupportedRange(year)) {
    return buildOutOfRangeLunarFallback(trimmed, year, month, day);
  }

  try {
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();

    const rawLunarMonth = lunar.getMonth(); // negative when leap month (e.g. -6 for 閏六月)
    const isLeapMonth = rawLunarMonth < 0;
    const lunarMonth = Math.abs(rawLunarMonth);
    const lunarDay = lunar.getDay();
    const lunarYear = lunar.getYear();

    let leapMonthOfYear: number | null = null;
    try {
      const lunarYearObj = LunarYear.fromYear(lunarYear);
      const rawLeapMonthOfYear = lunarYearObj.getLeapMonth();
      leapMonthOfYear = rawLeapMonthOfYear > 0 ? rawLeapMonthOfYear : null;
    } catch {
      leapMonthOfYear = null;
    }

    let lunarMonthDayCount = 30;
    try {
      const lunarMonthObj = LunarMonth.fromYm(lunarYear, rawLunarMonth);
      lunarMonthDayCount = lunarMonthObj ? lunarMonthObj.getDayCount() : 30;
    } catch {
      lunarMonthDayCount = 30;
    }

    const baseMonthName = LUNAR_MONTH_NAMES_ZH_TW[lunarMonth] ?? `${lunarMonth}月`;
    const lunarMonthLabel = isLeapMonth ? `閏${baseMonthName}` : baseMonthName;
    const lunarDayLabel = LUNAR_DAY_NAMES_ZH_TW[lunarDay] ?? String(lunarDay);

    const ganZhiYear = lunar.getYearInGanZhi();
    const rawZodiac = lunar.getYearShengXiao();
    const zodiac = ZODIAC_SIMPLIFIED_TO_ZH_TW[rawZodiac] ?? rawZodiac;
    const fullLunarLabel = `${ganZhiYear}年${lunarMonthLabel}${lunarDayLabel}（${zodiac}年）`;

    const rawJieQi = lunar.getJieQi();
    const solarTerm = rawJieQi ? (SOLAR_TERMS_ZH_TW_MAP[rawJieQi] ?? rawJieQi) : null;

    const traditionalFestival = resolveTraditionalLunarFestival(
      solar,
      lunarMonth,
      lunarDay,
      isLeapMonth,
    );

    const holidayEntry = resolveTaiwanOfficialHoliday(
      trimmed,
      solarTerm,
      traditionalFestival,
    );
    const officialHoliday = holidayEntry ? holidayEntry.name : null;
    const isHolidayDayOff = holidayEntry ? holidayEntry.isDayOff : false;

    // Priority for concise calendar cell label:
    // 1. Traditional Festival or Official Holiday (e.g., 春節, 除夕, 端午節, 中秋節, 國慶日, 和平紀念日)
    // 2. 24 Solar Term (e.g., 立春, 驚蟄, 清明, 夏至, 冬至)
    // 3. First day of a lunar month (lunarDay === 1): show lunarMonthLabel (e.g., 正月, 閏六月, 臘月)
    // 4. Regular lunar day: show lunarDayLabel (e.g., 初二, 十五, 廿三)
    let cellDisplayText = lunarDayLabel;
    let cellHighlightKind: LunarCellHighlightKind = 'normal';

    if (traditionalFestival || officialHoliday) {
      cellDisplayText = traditionalFestival ?? officialHoliday!;
      cellHighlightKind = 'festival';
    } else if (solarTerm) {
      cellDisplayText = solarTerm;
      cellHighlightKind = 'solar_term';
    } else if (lunarDay === 1) {
      cellDisplayText = lunarMonthLabel;
      cellHighlightKind = 'lunar_first_day';
    }

    return {
      dateStr: trimmed,
      lunarYear,
      lunarMonth,
      lunarDay,
      isLeapMonth,
      leapMonthOfYear,
      lunarMonthDayCount,
      ganZhiYear,
      zodiac,
      lunarMonthLabel,
      lunarDayLabel,
      fullLunarLabel,
      solarTerm,
      traditionalFestival,
      officialHoliday,
      isHolidayDayOff,
      cellDisplayText,
      cellHighlightKind,
      isOutOfSupportedRange: false,
    };
  } catch {
    return buildOutOfRangeLunarFallback(trimmed, year, month, day);
  }
}
