import { createFileRoute } from "@tanstack/react-router";
import { Download, Layers, MessageSquare, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  HOOK,
  IMAGINE_DURATION,
  PLATE_ORDER,
  plateDuration,
  type Caption,
  type PlateId,
} from "@/lib/composition";
import {
  MASK_SRC,
  VISEME_SRCS,
  kenBurns,
  sampleEnvelope,
  visemeAt,
  type Viseme,
} from "@/lib/lipsync";
import { aiStatus, askShed } from "@/lib/shed-ai";

export const Route = createFileRoute("/")({ component: Shed });

type Envelope = { rate: number; samples: number[] };
type Dock = "chat" | "renders";
type ChatMsg = { role: "user" | "shed"; text: string };

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

function formatTime(t: number) {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

function captionClass(size: Caption["size"]) {
  if (size === "xl")
    return "font-anton uppercase text-[32px] leading-[0.92] text-cyan drop-shadow-[0_4px_0_#050807]";
  if (size === "lg")
    return "font-anton uppercase text-[24px] leading-[0.92] drop-shadow-[0_3px_0_#050807]";
  return "font-anton uppercase text-[18px] leading-[0.95] max-w-[280px] drop-shadow-[0_3px_0_#050807]";
}

function parseCaptionPatch(text: string): { id: string; text: string }[] | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { captions?: { id: string; text: string }[] };
    if (!Array.isArray(parsed.captions) || !parsed.captions.length) return null;
    return parsed.captions;
  } catch {
    return null;
  }
}

function Shed() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [plate, setPlate] = useState<PlateId>("still");
  const [captions, setCaptions] = useState<Caption[]>(HOOK.captions);
  const [viseme, setViseme] = useState<Viseme>("rest");
  const [dock, setDock] = useState<Dock>("chat");
  const [aiOk, setAiOk] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([
    {
      role: "shed",
      text: "Still + captions is the cut. Imagine is the 10s cascade clip from that still.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const plateRef = useRef<PlateId>("still");
  plateRef.current = plate;
  const captionsRef = useRef(captions);
  captionsRef.current = captions;

  const assets = useRef<{
    cutout: HTMLImageElement | null;
    still: HTMLImageElement | null;
    frames: Partial<Record<Viseme, HTMLImageElement>>;
    mask: HTMLImageElement | null;
    env: Envelope | null;
    off: HTMLCanvasElement | null;
  }>({ cutout: null, still: null, frames: {}, mask: null, env: null, off: null });

  const paint = (t: number, v: Viseme, open: number, currentPlate: PlateId) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#050807";
    ctx.fillRect(0, 0, w, h);

    if (currentPlate === "imagine") {
      const vid = videoRef.current;
      if (vid && vid.readyState >= 2) ctx.drawImage(vid, 0, 0, w, h);
      else if (assets.current.still) ctx.drawImage(assets.current.still, 0, 0, w, h);
      return;
    }

    const kb = kenBurns(t);
    ctx.save();
    ctx.translate(w / 2, h * 0.32);
    ctx.scale(kb.scale, kb.scale);
    ctx.translate(-w / 2, -h * 0.32 + (kb.y / 100) * h);

    if (currentPlate === "cutout" && assets.current.cutout) {
      const glow = ctx.createRadialGradient(w * 0.5, h * 0.4, 8, w * 0.5, h * 0.42, w * 0.62);
      glow.addColorStop(0, "rgba(62,232,214,0.22)");
      glow.addColorStop(0.4, "rgba(196,120,58,0.1)");
      glow.addColorStop(1, "rgba(5,8,7,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      const img = assets.current.cutout;
      const scale = Math.max(w / img.width, h / img.height);
      ctx.drawImage(
        img,
        (w - img.width * scale) / 2,
        (h - img.height * scale) / 2,
        img.width * scale,
        img.height * scale,
      );
    } else if (currentPlate === "still" && assets.current.still) {
      ctx.drawImage(assets.current.still, 0, 0, w, h);
    } else {
      const rest = assets.current.frames.rest ?? assets.current.still;
      if (rest) ctx.drawImage(rest, 0, 0, w, h);
      const vis = assets.current.frames[v] ?? rest;
      const mask = assets.current.mask;
      const off = assets.current.off;
      if (vis && mask && off && open > 0.04 && v !== "rest") {
        const ox = off.getContext("2d");
        if (ox) {
          ox.clearRect(0, 0, off.width, off.height);
          ox.globalCompositeOperation = "source-over";
          ox.drawImage(vis, 0, 0, off.width, off.height);
          ox.globalCompositeOperation = "destination-in";
          ox.drawImage(mask, 0, 0, off.width, off.height);
          ox.globalCompositeOperation = "source-over";
          ctx.globalAlpha = Math.min(1, 0.2 + open * 0.95);
          ctx.drawImage(off, 0, 0, w, h);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
  };

  useEffect(() => {
    let dead = false;
    void aiStatus().then((s) => {
      if (!dead) setAiOk(s.ok);
    });
    (async () => {
      const [cutout, still, rest, ah, oh, ee, mb, mask, env] = await Promise.all([
        loadImage(HOOK.plates.cutout.src!),
        loadImage(HOOK.plates.still.src!),
        loadImage(VISEME_SRCS.rest),
        loadImage(VISEME_SRCS.ah),
        loadImage(VISEME_SRCS.oh),
        loadImage(VISEME_SRCS.ee),
        loadImage(VISEME_SRCS.mb),
        loadImage(MASK_SRC),
        fetch("/hook/assets/visemes/envelope.json").then((r) => r.json() as Promise<Envelope>),
      ]);
      if (dead) return;
      assets.current = {
        cutout,
        still,
        frames: { rest, ah, oh, ee, mb },
        mask,
        env,
        off: Object.assign(document.createElement("canvas"), { width: 720, height: 1280 }),
      };
      setReady(true);
    })().catch(() => setReady(false));
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => {
      const env = assets.current.env;
      const t =
        plateRef.current === "imagine"
          ? (videoRef.current?.currentTime ?? 0)
          : (audioRef.current?.currentTime ?? 0);
      const open = env ? sampleEnvelope(env.samples, env.rate, t) : 0;
      paint(t, visemeAt(t), open, plateRef.current);
    };
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    redraw();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plate, ready]);

  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio) return;
    let raf = 0;
    const media = () => (plateRef.current === "imagine" ? video : audio);
    const tick = () => {
      const el = media();
      const t = el?.currentTime ?? 0;
      const env = assets.current.env;
      const open = env ? sampleEnvelope(env.samples, env.rate, t) : 0;
      const v = visemeAt(t);
      setTime(t);
      setViseme(v);
      paint(t, v, open, plateRef.current);
      if (el && !el.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      tick();
    };
    const onEnded = () => {
      setPlaying(false);
      setTime(0);
      setViseme("rest");
      paint(0, "rest", 0, plateRef.current);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    video?.addEventListener("play", onPlay);
    video?.addEventListener("pause", onPause);
    video?.addEventListener("ended", onEnded);
    return () => {
      cancelAnimationFrame(raf);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      video?.removeEventListener("play", onPlay);
      video?.removeEventListener("pause", onPause);
      video?.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const toggle = () => {
    if (!ready) return;
    const audio = audioRef.current;
    const video = videoRef.current;
    if (plateRef.current === "imagine") {
      if (!video) return;
      audio?.pause();
      if (video.paused) void video.play();
      else video.pause();
    } else {
      if (!audio) return;
      video?.pause();
      if (audio.paused) void audio.play();
      else audio.pause();
    }
  };

  const seek = (t: number) => {
    const max = plateDuration(plateRef.current);
    const clamped = Math.min(max, Math.max(0, t));
    const audio = audioRef.current;
    const video = videoRef.current;
    if (plateRef.current === "imagine") {
      if (video) video.currentTime = clamped;
    } else if (audio) {
      audio.currentTime = clamped;
    }
    setTime(clamped);
    const env = assets.current.env;
    const open = env ? sampleEnvelope(env.samples, env.rate, clamped) : 0;
    paint(clamped, visemeAt(clamped), open, plate);
  };

  const pickPlate = (id: PlateId) => {
    audioRef.current?.pause();
    videoRef.current?.pause();
    setPlaying(false);
    setPlate(id);
    setTime(0);
    if (videoRef.current) videoRef.current.currentTime = 0;
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  const runAsk = async (prompt: string) => {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setChat((m) => [...m, { role: "user", text: prompt }]);
    setDraft("");
    const result = await askShed({
      data: {
        prompt,
        captions: captionsRef.current.map((c) => ({ id: c.id, text: c.text })),
      },
    });
    if (!result.ok) {
      setChat((m) => [...m, { role: "shed", text: result.error }]);
      setBusy(false);
      return;
    }
    const patch = parseCaptionPatch(result.text);
    if (patch) {
      setCaptions((prev) =>
        prev.map((c) => {
          const next = patch.find((p) => p.id === c.id);
          return next ? { ...c, text: next.text } : c;
        }),
      );
      setChat((m) => [...m, { role: "shed", text: "Applied caption rewrite on the timeline." }]);
    } else {
      setChat((m) => [...m, { role: "shed", text: result.text }]);
    }
    setBusy(false);
  };

  const active = captions.filter((c) => time >= c.start && time < c.end);
  const duration = plateDuration(plate);
  const showLockup = time >= HOOK.lockup.start || (!playing && time < 0.4);
  const progress = Math.min(1, time / duration);

  return (
    <main className="h-dvh bg-void text-ink flex flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/8 px-3 sm:px-4">
        <div className="flex items-center gap-3">
          <div className="relative size-7">
            <div className="absolute inset-0 rounded-full border border-copper" />
            <div className="absolute left-[5px] right-[5px] top-[13px] h-px bg-copper" />
            <div className="absolute top-[5px] bottom-[5px] left-[13px] w-px bg-copper" />
          </div>
          <div>
            <p className="text-[10px] tracking-[0.22em] uppercase text-copper leading-none">AIVIDMUSLLM</p>
            <h1 className="font-anton text-lg tracking-wide leading-none">SHED</h1>
          </div>
        </div>
        <p className="hidden md:block text-xs text-muted">
          {HOOK.name} · 9:16 · {plate === "imagine" ? `${IMAGINE_DURATION}s i2v` : `${HOOK.duration}s`}
        </p>
        <a
          href={plate === "imagine" ? "/hook/assets/imagine-hook.mp4" : HOOK.exportUrl}
          download={plate === "imagine" ? "PDragonLabs-imagine-hook.mp4" : "PDragonLabs-hook.mp4"}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan px-3 text-sm font-medium text-void transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          <Download className="size-3.5" strokeWidth={1.75} />
          Export
        </a>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[200px_minmax(0,1fr)_280px]">
        <aside className="hidden lg:flex flex-col gap-1 overflow-y-auto border-r border-white/8 p-3">
          <p className="mb-2 px-1 text-[10px] tracking-[0.2em] uppercase text-copper">Assets</p>
          {PLATE_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => pickPlate(id)}
              className={`flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors ${
                plate === id ? "bg-ink text-void" : "text-ink hover:bg-elevated"
              }`}
            >
              <Layers className="size-3.5 shrink-0" />
              {HOOK.plates[id].label}
            </button>
          ))}
          <div className="mt-4 px-1 text-xs text-muted leading-relaxed">
            Plate · VO · captions. Imagine is the 10s i2v from the still — motion, not HeyGen lips.
          </div>
        </aside>

        <section className="flex min-h-0 flex-col bg-black">
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            <button
              type="button"
              onClick={toggle}
              className="relative h-full max-h-full aspect-[9/16] overflow-hidden rounded-md bg-void"
              aria-label={playing ? "Pause" : "Play"}
            >
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
              <audio ref={audioRef} src={HOOK.audio} preload="auto" />
              <video
                ref={videoRef}
                src="/hook/assets/imagine-hook.mp4"
                preload="auto"
                playsInline
                className="hidden"
              />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,transparent_42%,rgba(5,8,7,0.5)_100%)]" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-void to-transparent" />
              <div className="absolute left-4 top-4 h-7 w-7">
                <div className="absolute inset-0 rounded-full border-2 border-copper" />
                <div className="absolute left-[5px] right-[5px] top-[13px] h-[2px] bg-copper" />
                <div className="absolute top-[5px] bottom-[5px] left-[13px] w-[2px] bg-copper" />
              </div>
              <div className="absolute inset-x-4 bottom-10 flex flex-col items-center gap-1.5 text-center">
                {active.map((c) => (
                  <p key={c.id} className={captionClass(c.size)}>
                    {c.text}
                  </p>
                ))}
                {showLockup && !playing ? (
                  <p className="font-anton tracking-[0.14em] text-lg">{HOOK.lockup.name}</p>
                ) : null}
              </div>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-white/8 px-3 py-2">
            <button
              type="button"
              onClick={toggle}
              className="flex size-9 items-center justify-center rounded-md text-cyan transition-transform duration-150 ease-out active:scale-[0.96]"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4 ml-px" />}
            </button>
            <span className="w-10 font-anton text-[11px] tabular-nums text-muted">{formatTime(time)}</span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.05}
              value={time}
              onChange={(e) => seek(Number(e.target.value))}
              className="h-1 flex-1 appearance-none rounded-full bg-white/10 accent-cyan"
              aria-label="Seek"
            />
            <span className="w-10 text-right font-anton text-[11px] tabular-nums text-muted">
              {formatTime(duration)}
            </span>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-t lg:border-t-0 lg:border-l border-white/8">
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/8 px-2">
            {(["chat", "renders"] as Dock[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setDock(id)}
                className={`h-8 rounded-md px-3 text-xs uppercase tracking-wider ${
                  dock === id ? "bg-elevated text-ink" : "text-muted"
                }`}
              >
                {id === "chat" ? "Chat" : "Renders"}
              </button>
            ))}
          </div>
          {dock === "chat" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
                {chat.map((m, i) => (
                  <p key={i} className={m.role === "shed" ? "text-muted" : "text-ink"}>
                    <span className="mr-2 text-[10px] uppercase tracking-wider text-copper">
                      {m.role}
                    </span>
                    {m.text}
                  </p>
                ))}
              </div>
              <div className="shrink-0 border-t border-white/8 p-3">
                <div className="mb-2 flex gap-2">
                  <button
                    type="button"
                    disabled={!aiOk || busy}
                    onClick={() => void runAsk("Tighten these captions. JSON only.")}
                    className="h-8 rounded-md border border-copper/30 px-3 text-xs text-ink disabled:opacity-40"
                  >
                    Tighten
                  </button>
                  <button
                    type="button"
                    disabled={!aiOk || busy}
                    onClick={() => void runAsk("More alchemy in the captions. JSON only.")}
                    className="h-8 rounded-md border border-copper/30 px-3 text-xs text-ink disabled:opacity-40"
                  >
                    Alchemy
                  </button>
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runAsk(draft);
                  }}
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={aiOk ? "Ask Shed…" : "AI unavailable"}
                    disabled={!aiOk || busy}
                    className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-elevated px-3 text-sm outline-none placeholder:text-muted"
                  />
                  <button
                    type="submit"
                    disabled={!aiOk || busy}
                    className="flex size-10 items-center justify-center rounded-md bg-ink text-void disabled:opacity-40"
                    aria-label="Send"
                  >
                    <MessageSquare className="size-4" />
                  </button>
                </form>
                <p className="mt-2 text-[10px] leading-relaxed text-muted">
                  {aiOk ? "xAI live. Jan is the later socket — OpenAI-compatible." : "No xAI key in this environment."}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-3">
              <a
                href={HOOK.exportUrl}
                download="PDragonLabs-hook.mp4"
                className="flex items-center justify-between rounded-md border border-white/10 bg-elevated px-3 py-3 text-sm hover:border-copper/40"
              >
                <span>PDragonLabs-hook.mp4</span>
                <span className="text-[10px] uppercase tracking-wider text-muted">13s still</span>
              </a>
              <a
                href="/hook/assets/imagine-hook.mp4"
                download="PDragonLabs-imagine-hook.mp4"
                className="flex items-center justify-between rounded-md border border-white/10 bg-elevated px-3 py-3 text-sm hover:border-copper/40"
              >
                <span>imagine-hook.mp4</span>
                <span className="text-[10px] uppercase tracking-wider text-muted">10s i2v</span>
              </a>
            </div>
          )}
        </aside>
      </div>

      <section className="shrink-0 border-t border-white/8 bg-elevated px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
          <span>Root</span>
          <span className="tabular-nums">
            {formatTime(time)} / {formatTime(duration)}
          </span>
        </div>
        <div className="space-y-1">
          <div className="relative h-6 rounded-sm bg-black/40">
            <div className="absolute inset-y-1 left-0 rounded-sm bg-cyan/25" style={{ width: "100%" }} />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-muted">
              plate · {HOOK.plates[plate].label}
            </span>
          </div>
          <div className="relative h-6 rounded-sm bg-black/40">
            <div className="absolute inset-y-1 left-0 rounded-sm bg-copper/30" style={{ width: "100%" }} />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-muted">
              audio · {plate === "imagine" ? "imagine native" : "vo"}
            </span>
          </div>
          <div className="relative h-8 rounded-sm bg-black/40">
            {captions.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => seek(c.start)}
                title={c.text}
                className={`absolute top-1 h-6 truncate rounded-sm px-1 text-left text-[9px] uppercase tracking-wide ${
                  time >= c.start && time < c.end ? "bg-cyan/50 text-void" : "bg-cyan/20 text-ink"
                }`}
                style={{
                  left: `${(c.start / HOOK.duration) * 100}%`,
                  width: `${((c.end - c.start) / HOOK.duration) * 100}%`,
                }}
              >
                {c.text}
              </button>
            ))}
          </div>
          <div className="relative h-2">
            <div className="absolute top-0 h-2 w-px bg-cyan" style={{ left: `${progress * 100}%` }} />
          </div>
        </div>
        <div className="mt-2 flex gap-2 lg:hidden overflow-x-auto">
          {PLATE_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => pickPlate(id)}
              className={`h-8 shrink-0 rounded-md px-3 text-xs ${plate === id ? "bg-ink text-void" : "border border-white/10"}`}
            >
              {HOOK.plates[id].label}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
