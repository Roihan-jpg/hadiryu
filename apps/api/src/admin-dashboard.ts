import {
  AdminDashboardResponseSchema,
  type AdminDashboardResponse,
  type DashboardDay,
} from "@absensi/contracts";
import {
  type AdminAttendanceRepository,
  toRecord,
  jakartaDateTime,
  withLiveUserSchedule,
} from "./admin-attendance.js";
import { resolveCalendarDay } from "./calendar-payroll.js";
import {
  addLocalDays,
  buildSecurityShiftBoundaries,
  resolveSecurityAssignment,
} from "./security-duty.js";

export async function createAdminDashboard(
  repository: AdminAttendanceRepository,
  now: Date,
  selected?: string,
): Promise<AdminDashboardResponse> {
  const current = jakartaDateTime(now);
  const workDate = selected ?? current.workDate;
  const operationalStart = await repository.findOperationalStart?.();
  const daily = await Promise.all(
    Array.from({ length: 7 }, async (_, index) => {
      const date = addLocalDays(workDate, index - 6);
      const [exception, sources] = await Promise.all([
        repository.findCalendarException(date),
        repository.listDailySources(date),
      ]);
      const calendar = resolveCalendarDay(date, exception);
      const schedule =
        calendar.scheduleType === "WEEKDAY" ||
        calendar.scheduleType === "SATURDAY"
          ? await repository.findSchedule?.(calendar.scheduleType, date)
          : null;
      const teachers = sources.filter(
        (source) =>
          source.role !== "SECURITY_GUARD" &&
          (!source.createdAt ||
            jakartaDateTime(new Date(source.createdAt)).workDate <= date),
      );
      const state: DashboardDay["state"] =
        (operationalStart && date < operationalStart) || date > current.workDate
          ? "NOT_STARTED"
          : !calendar.isWorkingDay
            ? "HOLIDAY"
            : !schedule
              ? "UNCONFIGURED"
              : "WORKING";
      const actual = teachers.filter(
        (source) =>
          source.attendance &&
          Date.parse(source.attendance.checkInAt) <= now.getTime(),
      );
      const day: DashboardDay = {
        workDate: date,
        state,
        description:
          exception?.name ??
          (state === "HOLIDAY"
            ? "Hari libur sekolah"
            : state === "UNCONFIGURED"
              ? "Jadwal belum tersedia"
              : state === "NOT_STARTED"
                ? "Di luar periode operasional yang berlangsung"
                : "Jadwal kerja Guru"),
        provisional: date === current.workDate,
        scheduled: state === "WORKING" ? teachers.length : null,
        arrived: state === "WORKING" ? actual.length : null,
        notCheckedIn:
          state === "WORKING"
            ? teachers.filter(
                (source) => !source.attendance && !source.approvedLeave,
              ).length
            : null,
        leave:
          state === "WORKING"
            ? teachers.filter((source) => source.approvedLeave).length
            : null,
        late:
          state === "WORKING"
            ? actual.filter((source) => {
                const resolved =
                  schedule && source.attendance
                    ? {
                        ...source,
                        attendance: withLiveUserSchedule(
                          source.attendance,
                          schedule,
                          date,
                        ),
                      }
                    : source;
                return (
                  (toRecord(resolved, date, current).arrivalLateMinutes ?? 0) >
                  0
                );
              }).length
            : null,
      };
      return { day, schedule, sources, actual };
    }),
  );
  const selectedDay = daily[6]!;
  const { day, schedule, sources, actual } = selectedDay;
  const instant = (time: string) =>
    new Date(`${workDate}T${time}:00+07:00`).toISOString();
  const window =
    schedule && day.state === "WORKING"
      ? {
          openAt: instant(schedule.checkInOpen),
          startAt: instant(schedule.workStart),
          closeAt: instant(schedule.checkInClose),
          observedUntil: new Date(
            Math.min(now.getTime(), Date.parse(instant(schedule.checkInClose))),
          ).toISOString(),
        }
      : null;
  const counts = new Map<string, number>();
  if (window)
    for (const source of actual) {
      const at = new Date(source.attendance!.checkInAt).toISOString();
      counts.set(at, (counts.get(at) ?? 0) + 1);
    }
  let cumulative = 0;
  const arrivals = [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([at, count]) => ({ at, count, cumulative: (cumulative += count) }));
  const settings = await repository.findSecuritySchedules?.(workDate);
  const guards: AdminDashboardResponse["guards"] = sources
    .filter((source) => source.role === "SECURITY_GUARD")
    .map((source) => {
      const savedType = source.attendance?.scheduleType;
      const assignment =
        savedType === "SECURITY_DAY"
          ? "DAY"
          : savedType === "SECURITY_NIGHT"
            ? "NIGHT"
            : settings?.roster
              ? resolveSecurityAssignment(
                  settings.roster,
                  workDate,
                  source.teacherId,
                ).status
              : "UNASSIGNED";
      const shift =
        assignment === "DAY"
          ? settings?.dayShift
          : assignment === "NIGHT"
            ? settings?.nightShift
            : null;
      const boundaries = shift
        ? buildSecurityShiftBoundaries(
            workDate,
            shift,
            assignment === "NIGHT" ? "SECURITY_NIGHT" : "SECURITY_DAY",
          )
        : null;
      const startAt =
        source.attendance?.workStartAt ?? boundaries?.workStartAt ?? null;
      const endAt =
        source.attendance?.workEndAt ?? boundaries?.workEndAt ?? null;
      const record = toRecord(source, workDate, current);
      const status =
        assignment === "OFF"
          ? "Libur rotasi"
          : assignment === "UNASSIGNED"
            ? "Belum masuk roster"
            : !shift && !source.attendance
              ? "Jadwal belum tersedia"
              : source.attendance
                ? {
                    PRESENT: source.attendance.checkOutAt
                      ? "Selesai bertugas"
                      : "Sudah check-in",
                    LATE: "Terlambat",
                    INCOMPLETE: "Checkout tidak tercatat",
                    LEAVE: "Izin disetujui",
                    NOT_PRESENT: "Belum check-in",
                    OFF: "Libur rotasi",
                  }[record.status]
                : source.approvedLeave
                  ? "Izin disetujui"
                  : startAt && Date.parse(startAt) > now.getTime()
                    ? "Belum waktunya bertugas"
                    : "Belum check-in";
      return {
        teacherId: source.teacherId,
        name: source.teacherFullName,
        assignment,
        status,
        startAt,
        endAt,
      };
    });
  return AdminDashboardResponseSchema.parse({
    workDate,
    generatedAt: now.toISOString(),
    day,
    window,
    arrivals,
    trend: daily.map((item) => item.day),
    guards,
    rosterAvailable: Boolean(settings?.roster),
  });
}
