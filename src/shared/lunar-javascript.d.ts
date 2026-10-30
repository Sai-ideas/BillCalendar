declare module 'lunar-javascript' {
  export class Lunar {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getYearInGanZhi(): string;
    getYearShengXiao(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getJieQi(): string;
    getFestivals(): string[];
    getOtherFestivals(): string[];
  }

  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    static fromDate(date: Date): Solar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getWeek(): number;
    toYmd(): string;
    next(days: number): Solar;
    getLunar(): Lunar;
  }

  export class LunarMonth {
    static fromYm(lunarYear: number, lunarMonth: number): LunarMonth | null;
    getDayCount(): number;
    isLeap(): boolean;
  }

  export class LunarYear {
    static fromYear(lunarYear: number): LunarYear;
    getLeapMonth(): number;
  }
}
