import type { ISODate, YearMonth } from '../contracts/types';

export function parseYearMonth(value: YearMonth): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`非法月份：${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`非法月份：${value}`);
  return { year, month };
}

export function getMonthDates(targetMonth: YearMonth): ISODate[] {
  const { year, month } = parseYearMonth(targetMonth);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => `${targetMonth}-${String(index + 1).padStart(2, '0')}`);
}

export function previousMonth(targetMonth: YearMonth): YearMonth {
  const { year, month } = parseYearMonth(targetMonth);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function toUtcDate(date: ISODate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function addDays(date: ISODate, days: number): ISODate {
  const value = toUtcDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function mondayOfWeek(date: ISODate): ISODate {
  const value = toUtcDate(date);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

export function monthOfDate(date: ISODate): YearMonth {
  return date.slice(0, 7);
}

export function isDateInMonth(date: ISODate, month: YearMonth): boolean {
  return monthOfDate(date) === month;
}

export function formatChineseDate(date: ISODate): string {
  const value = toUtcDate(date);
  const week = ['日', '一', '二', '三', '四', '五', '六'][value.getUTCDay()];
  return `${value.getUTCMonth() + 1}/${value.getUTCDate()} 周${week}`;
}

