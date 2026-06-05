import { describe, expect, it } from "vitest";
import { applyResults, ItemResult } from "../src/core/pipeline";
import type { ImageRef } from "../src/core/scanner";

function mkRef(originalText: string, from: number, kind: ImageRef["kind"] = "md"): ImageRef {
  const base = {
    kind, from, to: from + originalText.length, originalText, rawUrl: "./x.png",
  };
  if (kind === "md") return { ...base, alt: "" } as ImageRef;
  if (kind === "wikilink") return { ...base, wikiAlt: "", wikiSize: undefined } as ImageRef;
  return base as ImageRef;
}

describe("applyResults", () => {
  it("applies replacements in reverse offset order", () => {
    const source = "A ![a](./a.png) B ![b](./b.png) C";
    const results: ItemResult[] = [
      { ref: mkRef("![a](./a.png)", 2), status: "uploaded", newUrl: "https://oss/x.jpg" },
      { ref: mkRef("![b](./b.png)", 18), status: "uploaded", newUrl: "https://oss/y.jpg" },
    ];
    const out = applyResults(source, results);
    expect(out.content).toBe("A ![](https://oss/x.jpg) B ![](https://oss/y.jpg) C");
    expect(out.appliedCount).toBe(2);
    expect(out.driftedCount).toBe(0);
  });

  it("ignores failed / skipped results", () => {
    const source = "x ![a](./a.png) y";
    const results: ItemResult[] = [
      { ref: mkRef("![a](./a.png)", 2), status: "failed", reason: "boom" },
    ];
    const out = applyResults(source, results);
    expect(out.content).toBe(source);
    expect(out.appliedCount).toBe(0);
  });

  it("skips refs whose text has drifted (concurrent edit)", () => {
    const source = "DIFFERENT TEXT NOW";
    const results: ItemResult[] = [
      { ref: mkRef("![a](./a.png)", 0), status: "uploaded", newUrl: "https://oss/x.jpg" },
    ];
    const out = applyResults(source, results);
    expect(out.appliedCount).toBe(0);
    expect(out.driftedCount).toBe(1);
    expect(out.content).toBe(source);
  });
});
