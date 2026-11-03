import { initialPositions } from "./useLayoutLoop";

test("initialPositions reuses known tables and marks new ones NaN", () => {
  const prev = new Map<string, [number, number, number]>([["a", [1, 2, 3]], ["b", [4, 5, 6]]]);
  const out = initialPositions(["b", "new", "a"], prev)!;
  expect(Array.from(out.slice(0, 3))).toEqual([4, 5, 6]);
  expect(out.slice(3, 6).every(Number.isNaN)).toBe(true);
  expect(Array.from(out.slice(6, 9))).toEqual([1, 2, 3]);
});

test("a completely different schema starts fresh", () => {
  expect(initialPositions(["x"], new Map([["a", [1, 2, 3]]]))).toBeUndefined();
});
