"use client";

import { FormEvent, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Task = {
  id: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  remindBefore: number; // minutes
  completed: boolean;
  notified: boolean;
};

type Alert = {
  id: string;
  taskId: string;
  message: string;
  scheduledAt: string; // ISO string
};

const STORAGE_KEY = "daily-rhythm-tasks";

const templateBlueprint = [
  {
    title: "Morning Stretch",
    time: "07:00",
    description: "Loosen up with a 10 minute stretch routine.",
    remindBefore: 10,
  },
  {
    title: "Focus Block #1",
    time: "09:00",
    description: "Deep work session on priority project.",
    remindBefore: 15,
  },
  {
    title: "Lunch Break",
    time: "12:30",
    description: "Step away from the desk and recharge.",
    remindBefore: 10,
  },
  {
    title: "Afternoon Check-in",
    time: "15:00",
    description: "Review progress and adjust the plan.",
    remindBefore: 10,
  },
  {
    title: "Wrap-up & Plan Tomorrow",
    time: "18:00",
    description: "Log wins and prep tomorrow's priorities.",
    remindBefore: 15,
  },
];

const minutesOptions = [0, 5, 10, 15, 30, 45, 60];

const formatDateInput = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const combineDateTime = (date: string, time: string) => {
  const [hours = "00", minutes = "00"] = time.split(":");
  const [year, month, day] = date.split("-").map((part) => Number(part));
  return new Date(year, (month ?? 1) - 1, day ?? 1, Number(hours), Number(minutes), 0, 0);
};

const sortTasks = (data: Task[]) =>
  [...data].sort((a, b) => combineDateTime(a.date, a.time).getTime() - combineDateTime(b.date, b.time).getTime());

const getSoonestTask = (tasks: Task[]) => {
  const upcoming = tasks
    .filter((task) => !task.completed)
    .sort((a, b) => combineDateTime(a.date, a.time).getTime() - combineDateTime(b.date, b.time).getTime());
  return upcoming[0] ?? null;
};

const formatTimeLabel = (dateTime: Date) =>
  dateTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const formatDateLabel = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const dateObj = new Date(year, (month ?? 1) - 1, day ?? 1);
  return dateObj.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

const normalizeTimeValue = (value: string) => {
  if (!value) return "";
  const [hours = "00", minutes = "00"] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
};

const createId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => formatDateInput(new Date()));
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default",
  );
  const [formState, setFormState] = useState({
    title: "",
    description: "",
    date: "",
    time: "",
    remindBefore: 15,
  });
  const [isHydrated, setIsHydrated] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const audioContextRef = useRef<AudioContext | null>(null);
  const hasInitialisedTemplate = useRef(false);

  const saveTasks = useCallback((draft: Task[]) => {
    setTasks(sortTasks(draft));
  }, []);

  const playTone = useCallback(async () => {
    if (typeof window === "undefined") return;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const context = audioContextRef.current;
      if (context.state === "suspended") {
        await context.resume();
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(880, context.currentTime);

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 1.1);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();
      oscillator.stop(context.currentTime + 1.2);
    } catch (error) {
      console.error("Unable to play notification chime", error);
    }
  }, []);

  const triggerNotification = useCallback(
    (task: Task) => {
      const scheduled = combineDateTime(task.date, task.time);
      const message = `${task.title} starts at ${formatTimeLabel(scheduled)}${
        task.remindBefore ? ` (notified ${task.remindBefore} min early)` : ""
      }`;

      setAlerts((current) => {
        if (current.some((item) => item.taskId === task.id)) {
          return current;
        }
        return [
          ...current,
          {
            id: createId(),
            taskId: task.id,
            message,
            scheduledAt: scheduled.toISOString(),
          },
        ];
      });

      if (typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification(task.title, {
            body: message,
            tag: task.id,
          });
        }
      }

      playTone();
    },
    [playTone],
  );

  const ensureTemplate = useCallback(
    (targetDate: string) => {
      if (hasInitialisedTemplate.current) return;
      const blueprint = templateBlueprint.map((entry) => ({
        id: createId(),
        title: entry.title,
        description: entry.description,
        date: targetDate,
        time: entry.time,
        remindBefore: entry.remindBefore,
        completed: false,
        notified: false,
      }));
      saveTasks(blueprint);
      hasInitialisedTemplate.current = true;
    },
    [saveTasks],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed: Task[] = JSON.parse(stored);
        startTransition(() => {
          saveTasks(parsed);
        });
        hasInitialisedTemplate.current = true;
      } catch (error) {
        console.warn("Unable to read stored tasks, resetting", error);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    startTransition(() => {
      setIsHydrated(true);
    });
  }, [saveTasks]);

  useEffect(() => {
    if (!isHydrated) return;

    if (tasks.length === 0) {
      const today = formatDateInput(new Date());
      startTransition(() => {
        ensureTemplate(today);
        setSelectedDate(today);
      });
    }
  }, [isHydrated, tasks.length, ensureTemplate]);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;

    const interval = window.setInterval(() => {
      const now = new Date();
      const nowTime = now.getTime();

      setTasks((current) => {
        let touched = false;
        const next = current.map((task) => {
          if (task.completed || task.notified) {
            return task;
          }

          const scheduled = combineDateTime(task.date, task.time);
          const triggerTime = scheduled.getTime() - task.remindBefore * 60 * 1000;

          if (nowTime >= triggerTime) {
            touched = true;
            triggerNotification(task);
            return { ...task, notified: true };
          }

          return task;
        });

        return touched ? sortTasks(next) : current;
      });
    }, 1000 * 30);

    return () => window.clearInterval(interval);
  }, [isHydrated, triggerNotification]);

  useEffect(() => {
    if (!isHydrated) return;

    startTransition(() => {
      setFormState((prev) => ({
        ...prev,
        date: selectedDate || formatDateInput(new Date()),
        time: prev.time || normalizeTimeValue(new Date().toTimeString().slice(0, 5)),
      }));
    });
  }, [selectedDate, isHydrated]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(new Date());
    }, 1000 * 30);

    return () => window.clearInterval(tick);
  }, []);

  const selectedDayTasks = useMemo(() => tasks.filter((task) => task.date === selectedDate), [tasks, selectedDate]);

  const stats = useMemo(() => {
    const total = selectedDayTasks.length;
    const completed = selectedDayTasks.filter((task) => task.completed).length;
    const pending = total - completed;
    const nextTask = getSoonestTask(selectedDayTasks);

    return {
      total,
      completed,
      pending,
      nextTask,
    };
  }, [selectedDayTasks]);

  const requestNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    } catch (error) {
      console.error("Notification permission failed", error);
    }
  };

  const resetTemplateForDay = (date: string) => {
    const blueprint = templateBlueprint.map((entry) => ({
      id: createId(),
      title: entry.title,
      description: entry.description,
      date,
      time: entry.time,
      remindBefore: entry.remindBefore,
      completed: false,
      notified: false,
    }));

    setTasks((prev) => {
      const filtered = prev.filter((task) => task.date !== date);
      return sortTasks([...filtered, ...blueprint]);
    });
  };

  const acknowledgeAlert = (alertId: string) => {
    setAlerts((current) => current.filter((item) => item.id !== alertId));
  };

  const handleTaskCompletion = (taskId: string, completed: boolean) => {
    setTasks((prev) =>
      sortTasks(
        prev.map((task) =>
          task.id === taskId
            ? {
                ...task,
                completed,
              }
            : task,
        ),
      ),
    );
  };

  const handleTaskRemoval = (taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.title || !formState.date || !formState.time) {
      return;
    }

    const newTask: Task = {
      id: createId(),
      title: formState.title.trim(),
      description: formState.description.trim(),
      date: formState.date,
      time: normalizeTimeValue(formState.time),
      remindBefore: formState.remindBefore,
      completed: false,
      notified: false,
    };

    setTasks((prev) => sortTasks([...prev, newTask]));

    setFormState((prev) => ({
      ...prev,
      title: "",
      description: "",
      time: "",
    }));
  };

  const handleTaskUpdate = (taskId: string, updates: Partial<Omit<Task, "id">>) => {
    setTasks((prev) =>
      sortTasks(
        prev.map((task) =>
          task.id === taskId
            ? {
                ...task,
                ...updates,
                notified: updates.time || updates.date ? false : task.notified,
              }
            : task,
        ),
      ),
    );
  };

  const allDates = useMemo(() => {
    const unique = new Set(tasks.map((task) => task.date));
    const sorted = Array.from(unique).sort((a, b) => (a > b ? 1 : -1));
    return sorted;
  }, [tasks]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-slate-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-10">
        <header className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/5 px-6 py-6 backdrop-blur-md sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-slate-300">Daily Rhythm</p>
              <h1 className="text-3xl font-semibold sm:text-4xl">Plan the day and never miss a moment</h1>
              <p className="mt-2 max-w-xl text-sm text-slate-300">
                Pre-load your day with focused activity blocks, and Daily Rhythm will nudge you when it is time to
                switch gears.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm sm:items-end">
              <span className="font-medium text-slate-200">{formatDateLabel(selectedDate)}</span>
              <span className="text-xs text-slate-400">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs uppercase tracking-widest text-slate-400">Tasks planned</p>
              <p className="mt-2 text-3xl font-semibold">{stats.total}</p>
              <p className="mt-1 text-xs text-slate-400">Keep your day intentional.</p>
            </div>
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
              <p className="text-xs uppercase tracking-widest text-emerald-200">Completed</p>
              <p className="mt-2 text-3xl font-semibold text-emerald-200">{stats.completed}</p>
              <p className="mt-1 text-xs text-emerald-200/80">Celebrate progress as you go.</p>
            </div>
            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
              <p className="text-xs uppercase tracking-widest text-amber-200">Up next</p>
              {stats.nextTask ? (
                <div className="mt-2 text-sm text-amber-100">
                  <p className="text-base font-semibold">{stats.nextTask.title}</p>
                  <p className="text-xs text-amber-200/70">
                    {formatTimeLabel(combineDateTime(stats.nextTask.date, stats.nextTask.time))}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-2xl font-semibold text-amber-100">All clear</p>
              )}
            </div>
          </div>
        </header>

        {alerts.length > 0 && (
          <section className="grid gap-3 rounded-3xl border border-amber-300/30 bg-amber-400/15 px-5 py-4 text-amber-950 sm:grid-cols-2">
            {alerts.map((alert) => {
              const scheduled = new Date(alert.scheduledAt);
              return (
                <div
                  key={alert.id}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-amber-600/30 bg-white/70 px-4 py-3 shadow-lg shadow-amber-900/20"
                >
                  <div>
                    <p className="text-sm font-semibold">{alert.message}</p>
                    <p className="text-xs text-amber-800/70">
                      Scheduled for {scheduled.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <button
                    onClick={() => acknowledgeAlert(alert.id)}
                    className="rounded-full bg-amber-900/10 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-900/20"
                  >
                    Dismiss
                  </button>
                </div>
              );
            })}
          </section>
        )}

        {typeof window !== "undefined" && "Notification" in window && notificationPermission !== "granted" && (
          <section className="rounded-3xl border border-sky-400/25 bg-sky-500/10 px-5 py-4 text-sm text-sky-100">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">Enable desktop alerts</p>
                <p className="text-sky-100/80">Grant notification access so alarms pop up even when the tab is backgrounded.</p>
              </div>
              <button
                onClick={requestNotifications}
                className="h-10 rounded-full bg-sky-500 px-5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
              >
                Allow notifications
              </button>
            </div>
          </section>
        )}

        <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-300">
                Active day
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
              />
              <button
                onClick={() => resetTemplateForDay(selectedDate)}
                className="rounded-full border border-white/10 bg-black/30 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-200 transition hover:border-sky-400 hover:text-sky-200"
              >
                Load daily template
              </button>
              {allDates.length > 1 && (
                <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                  {allDates.map((date) => (
                    <button
                      key={date}
                      onClick={() => setSelectedDate(date)}
                      className={`rounded-full border px-3 py-1 transition ${
                        date === selectedDate
                          ? "border-sky-400 bg-sky-400/20 text-sky-100"
                          : "border-white/5 bg-white/0 hover:border-sky-400/40 hover:text-sky-200"
                      }`}
                    >
                      {formatDateLabel(date)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4">
              {selectedDayTasks.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-12 text-center text-slate-300">
                  <p className="text-lg font-medium">No tasks yet</p>
                  <p className="mt-2 text-sm">Add a block using the planner and Daily Rhythm will remind you when it matters.</p>
                </div>
              ) : (
                selectedDayTasks.map((task) => {
                  const scheduled = combineDateTime(task.date, task.time);
                  const isPast = scheduled.getTime() < now.getTime();
                  return (
                    <article
                      key={task.id}
                      className="group grid gap-4 rounded-3xl border border-white/10 bg-black/30 px-6 py-5 transition hover:border-sky-400/50 hover:bg-black/20 md:grid-cols-[auto,1fr,auto] md:items-center"
                    >
                      <div className="flex flex-col gap-1">
                        <p className="text-xs uppercase tracking-widest text-slate-400">{formatDateLabel(task.date)}</p>
                        <p className="text-xl font-semibold text-slate-100">{formatTimeLabel(scheduled)}</p>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-5 w-5 rounded border border-white/20 bg-black/40 text-sky-500"
                            checked={task.completed}
                            onChange={(event) => handleTaskCompletion(task.id, event.target.checked)}
                          />
                          <h2 className={`text-lg font-semibold ${task.completed ? "text-slate-400 line-through" : "text-slate-100"}`}>
                            {task.title}
                          </h2>
                        </div>
                        {task.description && (
                          <p className="text-sm text-slate-300/80">{task.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                            Remind {task.remindBefore} min before
                          </span>
                          {isPast && !task.completed && (
                            <span className="rounded-full border border-amber-400/30 bg-amber-500/20 px-3 py-1 text-amber-200">
                              Past due
                            </span>
                          )}
                          {task.completed && (
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                              Completed
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-3 text-xs text-slate-400">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleTaskRemoval(task.id)}
                            className="rounded-full border border-white/10 px-4 py-2 font-semibold uppercase tracking-widest text-slate-200 transition hover:border-rose-400/40 hover:text-rose-200"
                          >
                            Remove
                          </button>
                          <button
                            onClick={() =>
                              handleTaskUpdate(task.id, {
                                notified: false,
                                completed: false,
                                date: formatDateInput(new Date(Date.now() + 24 * 60 * 60 * 1000)),
                              })
                            }
                            className="rounded-full border border-white/10 px-4 py-2 font-semibold uppercase tracking-widest text-slate-200 transition hover:border-sky-400/40 hover:text-sky-200"
                          >
                            Push to tomorrow
                          </button>
                        </div>
                        <label className="flex items-center gap-2">
                          <span className="text-xs uppercase tracking-[0.3em]">Remind</span>
                          <select
                            value={task.remindBefore}
                            onChange={(event) =>
                              handleTaskUpdate(task.id, { remindBefore: Number(event.target.value), notified: false })
                            }
                            className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
                          >
                            {minutesOptions.map((value) => (
                              <option key={value} value={value}>
                                {value === 0 ? "At start" : `${value} min early`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2">
                          <span className="text-xs uppercase tracking-[0.3em]">Time</span>
                          <input
                            type="time"
                            value={task.time}
                            onChange={(event) =>
                              handleTaskUpdate(task.id, {
                                time: normalizeTimeValue(event.target.value),
                                notified: false,
                              })
                            }
                            className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
                          />
                        </label>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>

          <aside className="flex flex-col gap-6">
            <form
              onSubmit={handleFormSubmit}
              className="rounded-3xl border border-white/10 bg-white/10 px-6 py-6 text-sm backdrop-blur"
            >
              <h2 className="text-lg font-semibold text-white">Add an activity</h2>
              <p className="mt-1 text-xs text-slate-200/70">
                Pre-schedule anything you need to remember. We will cue you at the perfect moment.
              </p>

              <label className="mt-4 block text-xs uppercase tracking-[0.3em] text-slate-200">Title</label>
              <input
                type="text"
                value={formState.title}
                onChange={(event) => setFormState((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="What is happening?"
                className="mt-2 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-white focus:border-sky-400 focus:outline-none"
                required
              />

              <label className="mt-4 block text-xs uppercase tracking-[0.3em] text-slate-200">Description</label>
              <textarea
                value={formState.description}
                onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Add any supporting notes"
                className="mt-2 h-24 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-white focus:border-sky-400 focus:outline-none"
              />

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs uppercase tracking-[0.3em] text-slate-200">Date</label>
                  <input
                    type="date"
                    value={formState.date}
                    onChange={(event) => setFormState((prev) => ({ ...prev, date: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-white focus:border-sky-400 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.3em] text-slate-200">Time</label>
                  <input
                    type="time"
                    value={formState.time}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, time: normalizeTimeValue(event.target.value) }))
                    }
                    className="mt-2 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-white focus:border-sky-400 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <label className="mt-4 block text-xs uppercase tracking-[0.3em] text-slate-200">Remind me</label>
              <select
                value={formState.remindBefore}
                onChange={(event) => setFormState((prev) => ({ ...prev, remindBefore: Number(event.target.value) }))}
                className="mt-2 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-white focus:border-sky-400 focus:outline-none"
              >
                {minutesOptions.map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? "At start time" : `${value} minutes early`}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className="mt-6 w-full rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
              >
                Schedule activity
              </button>
            </form>

            <div className="rounded-3xl border border-white/10 bg-black/20 px-6 py-6 text-sm text-slate-200">
              <h3 className="text-base font-semibold text-white">Stay on top of your rhythm</h3>
              <ul className="mt-3 space-y-2 text-xs text-slate-300">
                <li>• Keep the tab open to hear the audio chimes as activities begin.</li>
                <li>• Grant browser notification permission for background alerts.</li>
                <li>• Adjust reminder offsets per activity to match the prep time you need.</li>
              </ul>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
