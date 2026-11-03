import { keyToAction } from "./shortcuts";

test("keyboard map matches the visual spec", () => {
  expect(keyToAction({ key: "/" })).toEqual({ type: "focusSearch" });
  expect(keyToAction({ key: "Escape" })).toEqual({ type: "back" });
  expect(keyToAction({ key: "f" })).toEqual({ type: "frameAll" });
  expect(keyToAction({ key: "+" })).toEqual({ type: "zoomIn" });
  expect(keyToAction({ key: "-" })).toEqual({ type: "zoomOut" });
  expect(keyToAction({ key: "ArrowLeft" })).toEqual({ type: "rotate15", dir: "left" });
  expect(keyToAction({ key: "ArrowDown" })).toEqual({ type: "rotate15", dir: "down" });
  expect(keyToAction({ key: "x" })).toBeNull();
});
