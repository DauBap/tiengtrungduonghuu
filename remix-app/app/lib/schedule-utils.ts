/**
 * Utilities for formatting and displaying class schedule information
 */

export interface ScheduleSlot {
  days: number[];
  startTime: string;
  endTime: string;
}

const DAY_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const DAY_NAMES_FULL = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

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

    for (const slot of slots) {
      if (!slot.days.includes(targetDay)) continue;

      const [startHour, startMin] = slot.startTime.split(":").map(Number);
      const startTimeMinutes = startHour * 60 + startMin;

      // If checking today, only return if class hasn't started yet
      if (daysAhead === 0 && startTimeMinutes <= currentTime) {
        continue;
      }

      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + daysAhead);
      nextDate.setHours(startHour, startMin, 0, 0);

      return nextDate;
    }
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
