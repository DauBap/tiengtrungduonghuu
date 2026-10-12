import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Card, CardContent } from "~/components/ui/card";
import { getEnrolledCoursesWithClass } from "~/lib/db.server";
import { requireRole } from "~/lib/session.server";

const WEEKDAYS = [
  { value: 1, label: "Thứ 2" },
  { value: 2, label: "Thứ 3" },
  { value: 3, label: "Thứ 4" },
  { value: 4, label: "Thứ 5" },
  { value: 5, label: "Thứ 6" },
  { value: 6, label: "Thứ 7" },
  { value: 0, label: "Chủ nhật" },
];

interface ScheduleSlot {
  days: number[];
  startTime: string;
  endTime: string;
}

function getWeekStart(date: Date) {
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  return weekStart;
}

function shiftWeek(date: Date, weeks: number) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + weeks * 7);
  return shifted;
}

function isScheduleSlot(value: unknown): value is ScheduleSlot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const slot = value as Record<string, unknown>;
  return Array.isArray(slot.days)
    && slot.days.every((day) => typeof day === "number" && day >= 0 && day <= 6)
    && typeof slot.startTime === "string"
    && typeof slot.endTime === "string";
}

function getScheduleSlots(value: unknown): ScheduleSlot[] {
  return Array.isArray(value) ? value.filter(isScheduleSlot) : [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const enrollments = await getEnrolledCoursesWithClass(user.id);

  return {
    user,
    classes: enrollments.flatMap((enrollment) => enrollment.class
      ? [{
          id: enrollment.class.id,
          name: enrollment.class.name,
          schedule: getScheduleSlots(enrollment.class.schedule),
          course: {
            code: enrollment.course.code,
            hskLevel: enrollment.course.hskLevel,
          },
        }]
      : []),
  };
}

export default function StudentSchedule() {
  const { user, classes } = useLoaderData<typeof loader>();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const today = new Date();
  const weekDates = WEEKDAYS.map((weekday, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return { ...weekday, date };
  });
  const weekEnd = weekDates[weekDates.length - 1].date;
  const rangeLabel = `${weekStart.toLocaleDateString("vi-VN", { day: "numeric", month: "long" })} - ${weekEnd.toLocaleDateString("vi-VN", { day: "numeric", month: "long", year: "numeric" })}`;

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lịch học</h1>
          <p className="mt-1 text-sm text-muted-foreground">Lịch các lớp của bạn theo từng tuần.</p>
        </div>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold">{rangeLabel}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWeekStart((current) => shiftWeek(current, -1))}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted"
                  aria-label="Tuần trước"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart(getWeekStart(new Date()))}
                  className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted"
                >
                  Tuần này
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart((current) => shiftWeek(current, 1))}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted"
                  aria-label="Tuần sau"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
              {weekDates.map(({ value, label, date }) => {
                const isToday = date.toDateString() === today.toDateString();
                const dayClasses = classes.flatMap((cls) =>
                  cls.schedule
                    .filter((slot) => slot.days.includes(value))
                    .map((slot) => ({ cls, slot }))
                ).sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime));

                return (
                  <section
                    key={value}
                    className={`min-h-36 rounded-lg border p-3 ${isToday ? "border-primary bg-primary/5 ring-1 ring-primary" : ""}`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className={`text-sm font-semibold ${isToday ? "text-primary" : ""}`}>{label}</h3>
                      <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs ${isToday ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground"}`}>
                        {date.getDate()}
                      </span>
                    </div>
                    {dayClasses.length > 0 ? (
                      <div className="space-y-2">
                        {dayClasses.map(({ cls, slot }, index) => (
                          <div key={`${cls.id}-${slot.startTime}-${index}`} className="rounded-md bg-muted/60 p-2">
                            <p className="text-sm font-medium leading-tight">{cls.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{cls.course.code} · HSK{cls.course.hskLevel}</p>
                            <p className="mt-2 flex items-center gap-1 text-xs text-primary">
                              <Clock className="h-3 w-3 shrink-0" />
                              {slot.startTime} - {slot.endTime}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Không có lịch học</p>
                    )}
                  </section>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
