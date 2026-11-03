import { DEFAULT_VISUAL, loadVisual, RANGES, saveVisual } from "./visualSettings";

beforeEach(() => localStorage.clear());

test("defaults when nothing is saved", () => {
  expect(loadVisual()).toEqual(DEFAULT_VISUAL);
  expect(DEFAULT_VISUAL).toEqual({ starSize: 1, brightness: 1, webLine: 1, spin: 1 });
});

test("saved values come back", () => {
  saveVisual({ starSize: 1.5, brightness: 0.6, webLine: 2, spin: 0.5 });
  expect(loadVisual()).toEqual({ starSize: 1.5, brightness: 0.6, webLine: 2, spin: 0.5 });
  expect(JSON.parse(localStorage.getItem("cosmos.visual")!)).toMatchObject({ starSize: 1.5 });
});

test("out-of-range, wrong-typed and missing values are fixed one by one", () => {
  localStorage.setItem("cosmos.visual", JSON.stringify({ starSize: 99, brightness: "bright", webLine: -4 }));
  const v = loadVisual();
  expect(v.starSize).toBe(RANGES.starSize[1]);
  expect(v.brightness).toBe(1);
  expect(v.webLine).toBe(RANGES.webLine[0]);
  expect(v.spin).toBe(1);
});

test("a broken saved value gives the defaults", () => {
  localStorage.setItem("cosmos.visual", "{nope");
  expect(loadVisual()).toEqual(DEFAULT_VISUAL);
});
