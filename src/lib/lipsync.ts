export type Viseme = "rest" | "ah" | "oh" | "ee" | "mb";

export const VISEME_SRCS: Record<Viseme, string> = {
  rest: "/hook/assets/visemes/rest.jpg",
  ah: "/hook/assets/visemes/ah.jpg",
  oh: "/hook/assets/visemes/oh.jpg",
  ee: "/hook/assets/visemes/ee.jpg",
  mb: "/hook/assets/visemes/mb.jpg",
};

export const MASK_SRC = "/hook/assets/visemes/mask.png";
export const VO_SRC = "/hook/assets/vo.mp3";
export const DURATION = 12.9;

/** Dominant mouth shape keyed to the 13s hook VO. */
const KEYS: { t: number; v: Viseme }[] = [
  { t: 0, v: "rest" },
  { t: 1.1, v: "oh" },
  { t: 1.38, v: "ee" },
  { t: 1.72, v: "ee" },
  { t: 2.05, v: "ah" },
  { t: 2.55, v: "ah" },
  { t: 3.05, v: "ah" },
  { t: 3.28, v: "ah" },
  { t: 3.48, v: "ee" },
  { t: 3.9, v: "ee" },
  { t: 4.3, v: "ee" },
  { t: 4.72, v: "ee" },
  { t: 5.05, v: "oh" },
  { t: 5.35, v: "ee" },
  { t: 5.55, v: "oh" },
  { t: 6.15, v: "ee" },
  { t: 6.58, v: "oh" },
  { t: 7.1, v: "mb" },
  { t: 7.28, v: "ah" },
  { t: 7.42, v: "ee" },
  { t: 7.82, v: "ah" },
  { t: 8.12, v: "ee" },
  { t: 8.5, v: "ee" },
  { t: 8.64, v: "rest" },
  { t: 8.98, v: "ah" },
  { t: 9.12, v: "ee" },
  { t: 9.4, v: "mb" },
  { t: 9.55, v: "oh" },
  { t: 9.72, v: "oh" },
  { t: 10.05, v: "ah" },
  { t: 10.35, v: "mb" },
  { t: 10.58, v: "ee" },
  { t: 10.94, v: "rest" },
];

export function visemeAt(t: number): Viseme {
  let v: Viseme = "rest";
  for (const k of KEYS) {
    if (t >= k.t) v = k.v;
    else break;
  }
  return v;
}

export function sampleEnvelope(
  samples: number[],
  rate: number,
  t: number,
): number {
  if (!samples.length) return 0;
  const i = t * rate;
  const i0 = Math.floor(i);
  const i1 = Math.min(samples.length - 1, i0 + 1);
  const a = samples[Math.max(0, Math.min(samples.length - 1, i0))] ?? 0;
  const b = samples[i1] ?? a;
  return a + (b - a) * (i - i0);
}

export function kenBurns(t: number) {
  const u = Math.min(1, t / DURATION);
  return { scale: 1.02 + 0.06 * u, y: 0.4 - 1.6 * u };
}
