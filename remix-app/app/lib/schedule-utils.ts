/**
 * Utilities for formatting and displaying class schedule information
 */

export interface ScheduleSlot {
  days: number[];
  startTime: string;
  endTime: string;
}

export type ScheduledSessionAvailability =
  | { allowed: true; date: string }
  | {
      allowed: false;
      date: string;
      reason: "no-schedule" | "before-start-date" | "future-date" | "wrong-day";
    };

const DAY_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const DAY_NAMES_FULL = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const WEEKDAY_NUMBERS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getVietnameseLocalDateInfo(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    day: WEEKDAY_NUMBERS[values.weekday] ?? -1,
  };
}

function getDateString(value: Date | string) {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === date ? date : null;
}

function parseTimeMinutes(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function getValidScheduledSlots(schedule: unknown): ScheduleSlot[] {
  if (!Array.isArray(schedule)) return [];
  return schedule.flatMap((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const slot = value as Partial<ScheduleSlot>;
    const startMinutes = parseTimeMinutes(slot.startTime);
    const endMinutes = parseTimeMinutes(slot.endTime);
    if (
      !Array.isArray(slot.days)
      || !slot.days.some((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      || startMinutes === null
      || endMinutes === null
      || endMinutes <= startMinutes
    ) {
      return [];
    }
    return [{ days: slot.days, startTime: slot.startTime!, endTime: slot.endTime! }];
  });
}

function getWeekday(date: string) {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function getScheduledDateAvailability(
  schedule: unknown,
  startDate: Date | string,
  date: string,
  now: Date = new Date(),
): ScheduledSessionAvailability {
  const today = getVietnameseLocalDateInfo(now).date;
  const targetDate = getDateString(date);
  const classStartDate = getDateString(startDate);
  if (!targetDate || !classStartDate) {
    return { allowed: false, date, reason: "no-schedule" };
  }
  const validSlots = getValidScheduledSlots(schedule);
  if (validSlots.length === 0) {
    return { allowed: false, date: targetDate, reason: "no-schedule" };
  }
  if (targetDate < classStartDate) {
    return { allowed: false, date: targetDate, reason: "before-start-date" };
  }
  if (targetDate > today) {
    return { allowed: false, date: targetDate, reason: "future-date" };
  }
  if (!validSlots.some((slot) => slot.days.includes(getWeekday(targetDate)))) {
    return { allowed: false, date: targetDate, reason: "wrong-day" };
  }
  return { allowed: true, date: targetDate };
}

export function getScheduledSessionAvailability(
  schedule: unknown,
  startDate: Date | string,
  now: Date = new Date(),
): ScheduledSessionAvailability {
  const today = getVietnameseLocalDateInfo(now).date;
  return getScheduledDateAvailability(schedule, startDate, today, now);
}

export function getMissingScheduledDates(
  schedule: unknown,
  startDate: Date | string,
  throughDate: string,
  recordedDates: string[],
  cancelledDates: string[],
): string[] {
  const classStartDate = getDateString(startDate);
  const endDate = getDateString(throughDate);
  const validSlots = getValidScheduledSlots(schedule);
  if (!classStartDate || !endDate || validSlots.length === 0 || classStartDate > endDate) return [];

  const recorded = new Set(recordedDates);
  const cancelled = new Set(cancelledDates);
  const missingDates: string[] = [];
  const cursor = new Date(`${classStartDate}T00:00:00.000Z`);
  const lastDate = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor < lastDate) {
    const date = cursor.toISOString().slice(0, 10);
    if (
      validSlots.some((slot) => slot.days.includes(cursor.getUTCDay()))
      && !recorded.has(date)
      && !cancelled.has(date)
    ) {
      missingDates.push(date);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return missingDates;
}

export function getScheduledSessionNumber(
  existingDates: string[],
  sessionDate: string,
): number {
  return existingDates.filter((date) => date < sessionDate).length + 1;
}

/**
 * Format schedule slots to readable Vietnamese string
 * Examples:
 * - "T2, T4, T6: 20:00 - 22:00"
 * - "T3, T5: 18:00 - 20:00"
 */
export function formatSchedule(schedule: unknown): string {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return "Chưa có lịch học";
  }

  const slots = schedule as ScheduleSlot[];
  return slots
    .map((slot) => {
      const days = slot.days
        .sort((a, b) => a - b)
        .map((d) => DAY_NAMES[d] ?? d)
        .join(", ");
      return `${days}: ${slot.startTime} - ${slot.endTime}`;
    })
    .join(" • ");
}

/**
 * Format schedule slots to full Vietnamese day names
 * Examples:
 * - "Thứ 2, Thứ 4, Thứ 6: 20:00 - 22:00"
 */
export function formatScheduleFull(schedule: unknown): string {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return "Chưa có lịch học";
  }

  const slots = schedule as ScheduleSlot[];
  return slots
    .map((slot) => {
      const days = slot.days
        .sort((a, b) => a - b)
        .map((d) => DAY_NAMES_FULL[d] ?? `Ngày ${d}`)
        .join(", ");
      return `${days}: ${slot.startTime} - ${slot.endTime}`;
    })
    .join(" • ");
}

/**
 * Get next class date/time from schedule
 * Returns null if no schedule or if we can't determine next class
 */
export function getNextClassTime(schedule: unknown): Date | null {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return null;
  }

  const now = new Date();
  const currentDay = now.getDay(); // 0=Sunday, 1=Monday, etc.
  const currentTime = now.getHours() * 60 + now.getMinutes();

  const slots = schedule as ScheduleSlot[];

  // Find nearest upcoming class in the next 7 days
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const targetDay = (currentDay + daysAhead) % 7;

    const upcomingSlot = slots
      .filter((slot) => slot.days.includes(targetDay))
      .map((slot) => {
        const [startHour, startMin] = slot.startTime.split(":").map(Number);
        return { startHour, startMin, startTimeMinutes: startHour * 60 + startMin };
      })
      .filter(({ startTimeMinutes }) => daysAhead > 0 || startTimeMinutes > currentTime)
      .sort((a, b) => a.startTimeMinutes - b.startTimeMinutes)[0];

    if (!upcomingSlot) continue;

    const nextDate = new Date(now);
    nextDate.setDate(nextDate.getDate() + daysAhead);
    nextDate.setHours(upcomingSlot.startHour, upcomingSlot.startMin, 0, 0);
    return nextDate;
  }

  return null;
}

/**
 * Format next class time to relative string
 * Examples:
 * - "Hôm nay 20:00"
 * - "Mai 18:00"
 * - "Thứ 4, 20:00"
 */
export function formatNextClass(schedule: unknown): string {
  const nextClass = getNextClassTime(schedule);
  if (!nextClass) return "Chưa có lịch";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const classDate = new Date(nextClass.getFullYear(), nextClass.getMonth(), nextClass.getDate());
  const daysDiff = Math.floor((classDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const timeStr = nextClass.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

  if (daysDiff === 0) return `Hôm nay ${timeStr}`;
  if (daysDiff === 1) return `Mai ${timeStr}`;

  const dayName = DAY_NAMES_FULL[nextClass.getDay()];
  return `${dayName}, ${timeStr}`;
}
