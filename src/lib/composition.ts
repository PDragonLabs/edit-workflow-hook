export type PlateId = "cutout" | "still" | "viseme" | "imagine";
export type CaptionSize = "xl" | "lg" | "md";

export type Caption = {
  id: string;
  start: number;
  end: number;
  text: string;
  size: CaptionSize;
};

/** PDragonLabs composition format — not HyperFrames. */
export type Composition = {
  id: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  audio: string;
  exportUrl: string;
  kenBurns: { from: number; to: number };
  lockup: { start: number; name: string; motto: string };
  plates: Record<PlateId, { label: string; src?: string; kind?: "image" | "viseme" | "video" }>;
  captions: Caption[];
};

export const HOOK: Composition = {
  id: "edit-workflow-hook",
  name: "Edit workflow hook",
  width: 1080,
  height: 1920,
  duration: 12.9,
  audio: "/hook/assets/vo.mp3",
  exportUrl: "/hook/assets/PDragonLabs-hook.mp4",
  kenBurns: { from: 1.02, to: 1.08 },
  lockup: {
    start: 11.1,
    name: "PDRAGONLABS",
    motto: "Solve et coagula · As above, so below",
  },
  plates: {
    still: { label: "Still", src: "/hook/assets/visemes/rest.jpg", kind: "image" },
    imagine: { label: "Imagine", src: "/hook/assets/imagine-hook.mp4", kind: "video" },
    cutout: { label: "Cutout", src: "/hook/assets/host-cut-916.png", kind: "image" },
    viseme: { label: "Viseme", kind: "viseme" },
  },
  captions: [
    { id: "wait", start: 1.05, end: 1.85, text: "OKAY WAIT", size: "xl" },
    { id: "chg", start: 1.8, end: 3.3, text: "THIS ACTUALLY CHANGED", size: "lg" },
    { id: "edit", start: 3.2, end: 5.4, text: "HOW I EDIT EVERY VIDEO", size: "md" },
    { id: "follow", start: 5.35, end: 6.6, text: "HIT FOLLOW", size: "xl" },
    { id: "tmrw", start: 6.5, end: 8.64, text: "TOMORROW I'M BREAKING IT DOWN", size: "md" },
    { id: "miss", start: 8.95, end: 11.1, text: "DON'T WANNA MISS IT", size: "lg" },
  ],
};

export const PLATE_ORDER: PlateId[] = ["still", "imagine", "cutout", "viseme"];
export const IMAGINE_DURATION = 10.04;

export function plateDuration(plate: PlateId) {
  return plate === "imagine" ? IMAGINE_DURATION : HOOK.duration;
}
