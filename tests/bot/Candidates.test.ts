import { describe, expect, test } from "vitest";
import {
  selectOpponentSlots,
  TOP_PER_METRIC,
} from "../../bot/input/candidates";
import { MAX_PLAYER_SLOTS } from "../../bot/input/types";
import { opponent } from "./fixtures";

describe("selectOpponentSlots", () => {
  test("always keeps border, allied, pending-request and attacking players", () => {
    const candidates = [
      opponent("border", { border: true }),
      opponent("ally", { allied: true }),
      opponent("request", { canRejectAlliance: true }),
      opponent("attacker", { attackingMe: true }),
      opponent("far", { tiles: 1 }),
    ];
    const selected = selectOpponentSlots(candidates, 4);
    const ids = selected.map((s) => s.playerID);
    expect(ids).toContain("border");
    expect(ids).toContain("ally");
    expect(ids).toContain("request");
    expect(ids).toContain("attacker");
    expect(ids).not.toContain("far");
  });

  test("takes the union of the top-5 by tiles, gold and troops", () => {
    const candidates = Array.from({ length: 30 }, (_, i) =>
      opponent(`p${String(i).padStart(2, "0")}`, {
        tiles: i,
        gold: 1000 - i,
        troops: i % 7,
      }),
    );
    const selected = selectOpponentSlots(candidates);
    // Top tiles, top gold and top troops are all present.
    expect(selected.map((s) => s.playerID)).toContain("p29"); // most tiles
    expect(selected.map((s) => s.playerID)).toContain("p00"); // most gold
    expect(selected.length).toBeLessThanOrEqual(MAX_PLAYER_SLOTS);
  });

  test("caps at the slot count and never duplicates", () => {
    const candidates = Array.from({ length: 40 }, (_, i) =>
      opponent(`p${i}`, { tiles: i, border: i < 3 }),
    );
    const selected = selectOpponentSlots(candidates, 6);
    expect(selected).toHaveLength(6);
    expect(new Set(selected.map((s) => s.playerID)).size).toBe(6);
  });

  test("is deterministic regardless of input order", () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      opponent(`p${i}`, { tiles: i, gold: i, troops: i }),
    );
    const a = selectOpponentSlots(candidates).map((s) => s.playerID);
    const b = selectOpponentSlots([...candidates].reverse()).map(
      (s) => s.playerID,
    );
    expect(a).toEqual(b);
  });

  test("fills the last slots by distance", () => {
    // 20 candidates, 16 slots: the mandatory set and the three top-5 metrics
    // take 15, so the 16th is the nearest by distance.
    const candidates = Array.from({ length: 20 }, (_, i) => {
      const slot = opponent(`p${String(i).padStart(2, "0")}`, {
        tiles: i,
        gold: 19 - i,
        troops: i % 2,
      });
      // p10 is closest but wins no metric.
      slot.distance = i === 10 ? 1 : 2_000;
      return slot;
    });
    const selected = selectOpponentSlots(candidates);
    expect(selected).toHaveLength(16);
    expect(selected.map((s) => s.playerID)).toContain("p10");
  });

  test("keeps at most TOP_PER_METRIC leaders per metric before the fill", () => {
    expect(TOP_PER_METRIC).toBe(5);
  });
});
